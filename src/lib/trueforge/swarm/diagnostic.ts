/**
 * TrueForge Diagnostic Subagent (thread_diagnostic_xxx)
 * Multi-framework test failure trace parser, AST symbol locator & confidence scorer.
 */

import type {
  DiagnosticReport,
  FailureFrame,
  RootCauseHypothesis,
  SourceLocation,
  SupportedFramework,
  AstNodeType,
} from '../types.ts';
import { eventBus } from '../event-bus.ts';

export class DiagnosticSubagent {
  /**
   * Run diagnostic analysis on test output logs and repository source files.
   */
  public async diagnose(
    sessionId: string,
    threadId: string,
    rawLog: string,
    repoFiles?: Map<string, string> | Record<string, string>,
    targetRepoUrl: string = 'https://github.com/openheal/workspace'
  ): Promise<DiagnosticReport> {
    const turnId = `turn_diag_${Date.now()}`;
    const cleanLog = this.stripAnsiCodes(rawLog);

    eventBus.emitEvent(sessionId, threadId, 'diagnostic.started', {
      threadId,
      logLength: cleanLog.length,
      timestamp: new Date().toISOString(),
    }, turnId);

    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      'Ingesting test runner failure logs and detecting testing framework...\n',
      turnId
    );

    // 1. Detect Framework
    const framework = this.detectFramework(cleanLog);
    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      `Detected test framework: ${framework}. Extracting stack frames and failure types...\n`,
      turnId
    );

    // 2. Parse Stack Frames & Failures
    const parsed = this.parseLogByFramework(framework, cleanLog);

    // 3. Resolve Primary and Secondary Frames (innermost source frame takes precedence)
    const primaryFrame = this.selectPrimaryFrame(parsed.frames);
    const primaryLocation = this.locateAstNode(
      primaryFrame?.filePath || 'unknown',
      primaryFrame?.lineNumber || 1,
      repoFiles
    );

    const secondaryLocations: SourceLocation[] = parsed.frames
      .filter((f) => f !== primaryFrame && f.isWorkspaceFile)
      .slice(0, 3)
      .map((f) => this.locateAstNode(f.filePath, f.lineNumber, repoFiles));

    // 4. Generate Hypotheses & Confidence Scoring
    const hypotheses = this.generateHypotheses(
      parsed.failureType,
      parsed.primaryMessage,
      primaryLocation,
      secondaryLocations,
      parsed.frames
    );

    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      `Root cause localized at ${primaryLocation.filePath}:${primaryLocation.startLine}. Hypothesis confidence: ${(hypotheses[0]?.confidenceScore ?? 0) * 100}%.\n`,
      turnId
    );

    const report: DiagnosticReport = {
      sessionId,
      threadId,
      timestamp: new Date().toISOString(),
      targetRepoUrl,
      frameworkDetected: framework,
      failureCount: parsed.failingTests.length || 1,
      failingTests: parsed.failingTests.length ? parsed.failingTests : ['unknown_test'],
      failureType: parsed.failureType || 'TestFailure',
      primaryFailureMessage: parsed.primaryMessage || 'Test execution failed',
      stackTraceFrames: parsed.frames,
      primaryRootCauseLocation: primaryLocation,
      secondaryLocations,
      hypotheses,
      rawLogExcerpt: cleanLog.slice(0, 2000),
    };

    eventBus.emitEvent(sessionId, threadId, 'diagnostic.completed', report, turnId);

    return report;
  }

  /**
   * Intelligently select the primary root cause frame from a stack trace.
   * Walks inward towards the actual exception site, prioritizing non-test source files.
   */
  public selectPrimaryFrame(frames: FailureFrame[]): FailureFrame | undefined {
    if (frames.length === 0) return undefined;

    const workspaceFrames = frames.filter((f) => f.isWorkspaceFile);
    if (workspaceFrames.length === 0) {
      return frames[frames.length - 1];
    }

    // Filter non-test implementation files
    const nonTestFrames = workspaceFrames.filter(
      (f) => !/(?:tests?\/|_tests?\.|\.test\.|\.spec\.|__tests__)/i.test(f.filePath)
    );

    if (nonTestFrames.length > 0) {
      // Pick deepest implementation frame
      return nonTestFrames[nonTestFrames.length - 1];
    }

    // Fallback to deepest workspace frame
    return workspaceFrames[workspaceFrames.length - 1];
  }

  /**
   * Strip ANSI escape color codes from terminal output.
   */
  public stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
  }

  /**
   * Detect test framework from raw logs.
   */
  public detectFramework(log: string): SupportedFramework {
    if (log.includes('pytest') || log.includes('FAILED tests/') || /===+ FAILURES ===+/.test(log) || /Traceback \(most recent call last\):/.test(log)) {
      return 'pytest';
    }
    if (log.includes('vitest') || (log.includes('FAIL') && log.includes('node_modules/vitest'))) {
      return 'vitest';
    }
    if (log.includes('jest') || (log.includes('FAIL') && (log.includes('.test.js') || log.includes('.test.ts') || log.includes('.spec.ts')))) {
      return 'jest';
    }
    if (log.includes('mocha') || (log.includes('failing') && /^\s*\d+\)\s+/m.test(log))) {
      return 'mocha';
    }
    if (log.includes('cargo test') || log.includes('test result: FAILED') || log.includes('panicked at')) {
      return 'cargo';
    }
    if (log.includes('--- FAIL:') || log.includes('go test')) {
      return 'gotest';
    }
    return 'generic';
  }

  /**
   * Parse logs according to the detected framework.
   */
  public parseLogByFramework(
    framework: SupportedFramework,
    log: string
  ): {
    failingTests: string[];
    failureType: string;
    primaryMessage: string;
    frames: FailureFrame[];
  } {
    switch (framework) {
      case 'pytest':
        return this.parsePytestLog(log);
      case 'jest':
      case 'vitest':
      case 'mocha':
        return this.parseJsTestLog(log);
      case 'cargo':
        return this.parseCargoLog(log);
      case 'gotest':
        return this.parseGoTestLog(log);
      default:
        return this.parseGenericLog(log);
    }
  }

  /**
   * Python pytest / unittest log parser.
   */
  private parsePytestLog(log: string) {
    const failingTests: string[] = [];
    const frames: FailureFrame[] = [];
    let failureType = 'AssertionError';
    let primaryMessage = '';

    // Match pytest summary: FAILED tests/test_calc.py::test_division
    const failedSummaryRegex = /(?:FAILED|ERROR)\s+([^\s:]+(?:::[\w_]+)+)/g;
    let match;
    while ((match = failedSummaryRegex.exec(log)) !== null) {
      failingTests.push(match[1]);
    }

    // Match Python Exception type and message (e.g. ZeroDivisionError: division by zero)
    const excRegex = /([A-Z][a-zA-Z0-9]*(?:Error|Exception|Interrupt|Exit)):\s*(.*)/g;
    while ((match = excRegex.exec(log)) !== null) {
      failureType = match[1];
      primaryMessage = match[2].trim() || match[1];
    }

    // Match Python stack frames: File "path/to/file.py", line 42, in func_name
    const frameRegex = /File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+([^\n\r]+))?/g;
    let frameIdx = 0;
    while ((match = frameRegex.exec(log)) !== null) {
      const filePath = match[1];
      const lineNumber = parseInt(match[2], 10);
      const functionName = match[3]?.trim();
      const isWorkspace = !filePath.includes('site-packages') && !filePath.includes('/lib/python');

      frames.push({
        frameIndex: frameIdx++,
        filePath,
        lineNumber,
        functionName,
        isWorkspaceFile: isWorkspace,
        rawLineText: match[0],
      });
    }

    // If no failing tests parsed, try unittest pattern
    if (failingTests.length === 0) {
      const unittestRegex = /FAIL:\s+([^\s]+)\s+\(([^)]+)\)/g;
      while ((match = unittestRegex.exec(log)) !== null) {
        failingTests.push(`${match[2]}.${match[1]}`);
      }
    }

    return {
      failingTests: [...new Set(failingTests)],
      failureType: failureType || 'PythonExecutionError',
      primaryMessage: primaryMessage || 'Pytest assertion or runtime failure',
      frames: frames.length ? frames : this.extractFallbackFrames(log),
    };
  }

  /**
   * JavaScript / TypeScript Jest / Vitest / Mocha parser.
   */
  private parseJsTestLog(log: string) {
    const failingTests: string[] = [];
    const frames: FailureFrame[] = [];
    let failureType = 'Error';
    let primaryMessage = '';

    // Match FAIL src/math.test.ts
    const failFileRegex = /FAIL\s+([^\s\n]+\.(?:ts|js|tsx|jsx))/g;
    let match;
    while ((match = failFileRegex.exec(log)) !== null) {
      failingTests.push(match[1]);
    }

    // Match ● Test Suite > Test Name or ✕ test name
    const testNameRegex = /(?:●|✕)\s+([^\n]+)/g;
    while ((match = testNameRegex.exec(log)) !== null) {
      failingTests.push(match[1].trim());
    }

    // Match Error: message or TypeError: message
    const errRegex = /([A-Za-z0-9_$]*Error):\s*([^\n]+)/g;
    while ((match = errRegex.exec(log)) !== null) {
      failureType = match[1];
      primaryMessage = match[2].trim();
    }

    // Match JS stack trace: at functionName (path/to/file.ts:42:15) or at path/to/file.ts:42:15
    const jsFrameRegex = /at\s+(?:([^\s(]+)\s+\()?([^:()\s]+):(\d+):(\d+)\)?/g;
    let frameIdx = 0;
    while ((match = jsFrameRegex.exec(log)) !== null) {
      const functionName = match[1]?.trim();
      const filePath = match[2];
      const lineNumber = parseInt(match[3], 10);
      const colNumber = parseInt(match[4], 10);
      const isWorkspace = !filePath.includes('node_modules') && !filePath.startsWith('node:');

      frames.push({
        frameIndex: frameIdx++,
        filePath,
        lineNumber,
        columnNumber: colNumber,
        functionName,
        isWorkspaceFile: isWorkspace,
        rawLineText: match[0],
      });
    }

    return {
      failingTests: [...new Set(failingTests)],
      failureType: failureType || 'JavaScriptError',
      primaryMessage: primaryMessage || 'JavaScript/TypeScript test failure',
      frames: frames.length ? frames : this.extractFallbackFrames(log),
    };
  }

  /**
   * Rust cargo test log parser.
   */
  private parseCargoLog(log: string) {
    const failingTests: string[] = [];
    const frames: FailureFrame[] = [];
    let failureType = 'Panic';
    let primaryMessage = '';

    // Match "test tests::test_parse ... FAILED"
    const cargoFailRegex = /test\s+([^\s]+)\s+\.\.\.\s+FAILED/g;
    let match;
    while ((match = cargoFailRegex.exec(log)) !== null) {
      failingTests.push(match[1]);
    }

    // Match "panicked at 'message', src/lib.rs:42:10"
    const panicRegex = /panicked at '(.*?)',\s*([^:]+):(\d+):(\d+)/g;
    let frameIdx = 0;
    while ((match = panicRegex.exec(log)) !== null) {
      failureType = 'RustPanic';
      primaryMessage = match[1];
      const filePath = match[2];
      const lineNumber = parseInt(match[3], 10);
      const columnNumber = parseInt(match[4], 10);

      frames.push({
        frameIndex: frameIdx++,
        filePath,
        lineNumber,
        columnNumber,
        functionName: 'panicked',
        isWorkspaceFile: !filePath.includes('.cargo'),
        rawLineText: match[0],
      });
    }

    return {
      failingTests: [...new Set(failingTests)],
      failureType,
      primaryMessage: primaryMessage || 'Rust cargo test failure',
      frames: frames.length ? frames : this.extractFallbackFrames(log),
    };
  }

  /**
   * Go go test log parser.
   */
  private parseGoTestLog(log: string) {
    const failingTests: string[] = [];
    const frames: FailureFrame[] = [];
    let failureType = 'GoTestFailure';
    let primaryMessage = '';

    // Match "--- FAIL: TestFoo (0.00s)"
    const goFailRegex = /---\s+FAIL:\s+([^\s]+)/g;
    let match;
    while ((match = goFailRegex.exec(log)) !== null) {
      failingTests.push(match[1]);
    }

    // Match "foo_test.go:42: message"
    const goLineRegex = /([a-zA-Z0-9_./\\-]+\.go):(\d+):\s*(.*)/g;
    let frameIdx = 0;
    while ((match = goLineRegex.exec(log)) !== null) {
      const filePath = match[1];
      const lineNumber = parseInt(match[2], 10);
      const message = match[3];
      if (!primaryMessage) primaryMessage = message;

      frames.push({
        frameIndex: frameIdx++,
        filePath,
        lineNumber,
        functionName: 'Test',
        isWorkspaceFile: true,
        rawLineText: match[0],
      });
    }

    return {
      failingTests: [...new Set(failingTests)],
      failureType,
      primaryMessage: primaryMessage || 'Go test assertion failure',
      frames: frames.length ? frames : this.extractFallbackFrames(log),
    };
  }

  /**
   * Generic fallback parser.
   */
  private parseGenericLog(log: string) {
    const frames = this.extractFallbackFrames(log);
    const primaryMessage = log.split('\n').find((l) => /error|fail|exception|fatal/i.test(l)) || 'Command returned non-zero exit code';

    return {
      failingTests: ['unspecified_test_suite'],
      failureType: 'GenericFailure',
      primaryMessage: primaryMessage.trim(),
      frames,
    };
  }

  /**
   * Extract fallback frames via regex file:line patterns.
   */
  private extractFallbackFrames(log: string): FailureFrame[] {
    const frames: FailureFrame[] = [];
    const genericRegex = /([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/g;
    let match;
    let frameIdx = 0;
    while ((match = genericRegex.exec(log)) !== null) {
      const filePath = match[1];
      const lineNumber = parseInt(match[2], 10);
      const columnNumber = match[3] ? parseInt(match[3], 10) : undefined;
      const isWorkspace = !filePath.includes('node_modules') && !filePath.includes('vendor') && !filePath.includes('.cargo');

      // Skip common non-source file matches
      if (/\.(png|jpg|lock|json|md)$/i.test(filePath)) continue;

      frames.push({
        frameIndex: frameIdx++,
        filePath,
        lineNumber,
        columnNumber,
        isWorkspaceFile: isWorkspace,
        rawLineText: match[0],
      });
    }

    if (frames.length === 0) {
      frames.push({
        frameIndex: 0,
        filePath: 'src/index.ts',
        lineNumber: 1,
        isWorkspaceFile: true,
        rawLineText: 'Fallback source location',
      });
    }

    return frames;
  }

  /**
   * Robust file lookup from repository files map/object.
   */
  public getFileContent(
    filePath: string,
    repoFiles?: Map<string, string> | Record<string, string>
  ): string {
    if (!repoFiles) return '';
    const clean = filePath.replace(/^\.\//, '');
    const stripped = clean.replace(/^\/workspace\//, '').replace(/^\/app\//, '').replace(/^\/home\/[^\/]+\//, '');

    if (repoFiles instanceof Map) {
      if (repoFiles.has(filePath)) return repoFiles.get(filePath)!;
      if (repoFiles.has(clean)) return repoFiles.get(clean)!;
      if (repoFiles.has(stripped)) return repoFiles.get(stripped)!;
      for (const [k, v] of repoFiles.entries()) {
        const cleanK = k.replace(/^\.\//, '');
        if (clean.endsWith(cleanK) || cleanK.endsWith(clean) || stripped.endsWith(cleanK) || cleanK.endsWith(stripped)) {
          return v;
        }
      }
    } else if (typeof repoFiles === 'object') {
      if (filePath in repoFiles) return repoFiles[filePath];
      if (clean in repoFiles) return repoFiles[clean];
      if (stripped in repoFiles) return repoFiles[stripped];
      for (const [k, v] of Object.entries(repoFiles)) {
        const cleanK = k.replace(/^\.\//, '');
        if (clean.endsWith(cleanK) || cleanK.endsWith(clean) || stripped.endsWith(cleanK) || cleanK.endsWith(stripped)) {
          return v;
        }
      }
    }
    return '';
  }

  /**
   * AST Symbol & Code Window Locator.
   */
  public locateAstNode(
    filePath: string,
    lineNumber: number,
    repoFiles?: Map<string, string> | Record<string, string>
  ): SourceLocation {
    const content = this.getFileContent(filePath, repoFiles);
    const lines = content ? content.split('\n') : [];
    const targetIdx = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
    let symbolName: string | undefined;
    let nodeType: AstNodeType = 'Unknown';

    if (lines.length > 0) {
      // Scan upwards to find enclosing symbol (function, method, class)
      for (let i = targetIdx; i >= 0; i--) {
        const line = lines[i];

        // Python def / class
        const pyFunc = /^\s*def\s+([a-zA-Z0-9_]+)\s*\(/.exec(line);
        if (pyFunc) {
          symbolName = pyFunc[1];
          nodeType = 'FunctionDeclaration';
          break;
        }
        const pyClass = /^\s*class\s+([a-zA-Z0-9_]+)/.exec(line);
        if (pyClass) {
          symbolName = pyClass[1];
          nodeType = 'ClassDeclaration';
          break;
        }

        // JS/TS function / method / class / arrow
        const jsFunc = /^\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/.exec(line);
        if (jsFunc) {
          symbolName = jsFunc[1];
          nodeType = 'FunctionDeclaration';
          break;
        }
        const jsArrow = /^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(line);
        if (jsArrow) {
          symbolName = jsArrow[1];
          nodeType = 'FunctionDeclaration';
          break;
        }
        const jsMethod = /^\s*(?:public|private|protected|async)?\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[:{]/.exec(line);
        if (jsMethod && !line.includes('if') && !line.includes('for') && !line.includes('while')) {
          symbolName = jsMethod[1];
          nodeType = 'MethodDefinition';
          break;
        }
        const jsClass = /^\s*(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/.exec(line);
        if (jsClass) {
          symbolName = jsClass[1];
          nodeType = 'ClassDeclaration';
          break;
        }

        // Rust fn / struct / impl
        const rustFn = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/.exec(line);
        if (rustFn) {
          symbolName = rustFn[1];
          nodeType = 'FunctionDeclaration';
          break;
        }
        const rustImpl = /^\s*impl(?:\s+[a-zA-Z0-9_]+)?\s+for\s+([a-zA-Z0-9_]+)/.exec(line);
        if (rustImpl) {
          symbolName = rustImpl[1];
          nodeType = 'ImplBlock';
          break;
        }

        // Go func
        const goFunc = /^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)/.exec(line);
        if (goFunc) {
          symbolName = goFunc[1];
          nodeType = 'FunctionDeclaration';
          break;
        }
      }
    }

    // Extract window of lines around targetIdx
    const snippetLines: string[] = [];
    if (lines.length > 0) {
      const windowStart = Math.max(0, targetIdx - 5);
      const windowEnd = Math.min(lines.length, targetIdx + 6);
      for (let i = windowStart; i < windowEnd; i++) {
        const lineNumStr = String(i + 1).padStart(4, ' ');
        const marker = i === targetIdx ? ' > ' : '   ';
        snippetLines.push(`${lineNumStr}${marker}${lines[i]}`);
      }
    } else {
      snippetLines.push(`Line ${lineNumber} in ${filePath}`);
    }

    return {
      filePath,
      startLine: lineNumber,
      endLine: lineNumber,
      symbolName,
      nodeType,
      codeSnippet: snippetLines.join('\n'),
    };
  }

  /**
   * Diagnostic Hypothesis Generator & Confidence Scorer.
   */
  public generateHypotheses(
    failureType: string,
    primaryMessage: string,
    primaryLocation: SourceLocation,
    secondaryLocations: SourceLocation[],
    frames: FailureFrame[]
  ): RootCauseHypothesis[] {
    const hypotheses: RootCauseHypothesis[] = [];
    const isDirectWorkspace = frames.some((f) => f.isWorkspaceFile);

    // Calculate confidence score
    let confidence = 0.85;
    if (!isDirectWorkspace) confidence -= 0.2;
    if (primaryLocation.symbolName) confidence += 0.05;
    if (failureType === 'AssertionError' || failureType === 'ZeroDivisionError' || failureType === 'TypeError') {
      confidence += 0.05;
    }
    confidence = Math.min(0.98, Math.max(0.4, Number(confidence.toFixed(2))));

    // Primary Hypothesis
    hypotheses.push({
      id: 'hyp_01',
      title: `${failureType} in ${primaryLocation.symbolName || primaryLocation.filePath}`,
      description: `Test failed with ${failureType}: "${primaryMessage}". The failure originates at ${primaryLocation.filePath}:${primaryLocation.startLine}.`,
      confidenceScore: confidence,
      implicatedLocations: [primaryLocation, ...secondaryLocations],
      suggestedFixDirection: `Inspect ${primaryLocation.symbolName || primaryLocation.filePath} and ensure proper input validation, boundary checks, or correct return value handling matching test assertions.`,
    });

    // Secondary Hypothesis if multiple frames
    if (secondaryLocations.length > 0) {
      hypotheses.push({
        id: 'hyp_02',
        title: `Caller regression in ${secondaryLocations[0].symbolName || secondaryLocations[0].filePath}`,
        description: `Potential mismatch between caller expectations in ${secondaryLocations[0].filePath} and callee implementation in ${primaryLocation.filePath}.`,
        confidenceScore: Number((confidence * 0.7).toFixed(2)),
        implicatedLocations: secondaryLocations,
        suggestedFixDirection: `Check caller argument passing and state initialization in ${secondaryLocations[0].filePath}.`,
      });
    }

    return hypotheses;
  }
}

export const diagnosticSubagent = new DiagnosticSubagent();
export const createDiagnosticAgent = () => new DiagnosticSubagent();
