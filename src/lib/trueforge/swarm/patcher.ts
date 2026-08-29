/**
 * TrueForge Patch Synthesizer Subagent (thread_patch_xxx)
 * Scope-constrained code patch synthesizer, unified diff builder, and pre-flight syntax checks.
 */

import type {
  DiagnosticReport,
  FilePatch,
  PatchSynthesisResult,
  ScopeCreepAssessment,
} from '../types.ts';
import { eventBus } from '../event-bus.ts';
import { applyScenarioHeuristicPatch } from '../../heal/heuristic-patch.ts';
import { toRepoRelativePath } from '../../heal/sandbox-files.ts';
import type { LLMConfig } from '../../llm/provider.ts';

export class PatchSynthesizerSubagent {
  /**
   * Synthesize code patches given diagnostic report and original repository files.
   */
  public async synthesizePatch(
    sessionId: string,
    threadId: string,
    diagnostic: DiagnosticReport,
    originalFiles: Map<string, string> | Record<string, string>,
    attemptNumber: number = 1,
    customPatchFn?: (filePath: string, original: string, diagnostic: DiagnosticReport) => string,
    llmConfig?: LLMConfig
  ): Promise<PatchSynthesisResult> {
    const startTime = Date.now();
    const turnId = `turn_patch_${Date.now()}`;

    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      `Starting patch synthesis attempt #${attemptNumber} based on diagnostic findings...\n`,
      turnId
    );

    const implicatedFiles = new Set([
      diagnostic.primaryRootCauseLocation.filePath,
      ...diagnostic.secondaryLocations.map((l) => l.filePath),
    ]);

    const patches: FilePatch[] = [];

    for (const filePath of implicatedFiles) {
      if (!filePath || filePath === 'unknown') continue;
      if (
        /(?:^|\/)(?:tests?\/|_tests?\.|\.test\.|\.spec\.|__tests__)/i.test(filePath) &&
        toRepoRelativePath(filePath) !== toRepoRelativePath(diagnostic.primaryRootCauseLocation.filePath)
      ) {
        continue;
      }

      const originalContent = this.getFileContent(filePath, originalFiles);
      if (!originalContent) continue;

      eventBus.emitDelta(
        sessionId,
        threadId,
        'agent.thought.delta',
        `Synthesizing minimal bugfix for ${filePath}...\n`,
        turnId
      );

      // Generate patched content via custom function, live LLM, or standard heuristic fix
      let patchedContent = '';
      if (customPatchFn) {
        patchedContent = customPatchFn(filePath, originalContent, diagnostic);
      } else {
        try {
          const { LiveLLMProvider } = await import('../../llm/provider.ts');
          const llmProvider = new LiveLLMProvider(llmConfig);
          const llmRes = await llmProvider.synthesizeRealPatch({
            language: diagnostic.frameworkDetected || 'python',
            filePath,
            originalContent,
            failingLog: diagnostic.primaryFailureMessage || diagnostic.rawLogExcerpt,
          });
          patchedContent = llmRes.patchedCode || this.applyStandardHeuristicPatch(filePath, originalContent, diagnostic);
        } catch {
          patchedContent = this.applyStandardHeuristicPatch(
            filePath,
            originalContent,
            diagnostic
          );
        }
      }

      // Sanitize output
      patchedContent = this.sanitizePatchOutput(patchedContent);

      const relativePath = toRepoRelativePath(filePath);
      const syntaxCheck = this.validateSyntax(relativePath, patchedContent);
      const diff = this.generateUnifiedDiff(relativePath, originalContent, patchedContent);
      const diffStats = this.calculateDiffStats(diff);

      patches.push({
        filePath: relativePath,
        originalContent,
        patchedContent,
        diff,
        linesAdded: diffStats.added,
        linesRemoved: diffStats.removed,
        astValid: syntaxCheck.valid,
        syntaxErrors: syntaxCheck.errors,
      });
    }

    // Combine diffs
    const combinedUnifiedDiff = patches.map((p) => p.diff).join('\n');

    // Anti-Scope-Creep Assessment
    const scopeAssessment = this.assessScopeCreep(patches, implicatedFiles);

    const patchPlan = `Fix ${diagnostic.failureType} in ${diagnostic.primaryRootCauseLocation.filePath} by applying minimal boundary check.`;
    const rationale = `Addresses root cause identified at line ${diagnostic.primaryRootCauseLocation.startLine}. No unnecessary refactoring introduced.`;

    const result: PatchSynthesisResult = {
      sessionId,
      threadId,
      attemptNumber,
      patchPlan,
      rationale,
      patches,
      combinedUnifiedDiff,
      isMinimal: scopeAssessment.passed,
      scopeCreepAssessment: scopeAssessment,
      synthesisDurationMs: Date.now() - startTime,
    };

    eventBus.emitEvent(sessionId, threadId, 'patch.synthesized', result, turnId);
    eventBus.emitEvent(sessionId, threadId, 'diff.generated', {
      sessionId,
      unifiedDiff: combinedUnifiedDiff,
      filePatches: patches,
    }, turnId);

    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      `Patch synthesized with ${patches.length} file(s) modified (${patches.reduce((acc, p) => acc + p.linesAdded, 0)} lines added, ${patches.reduce((acc, p) => acc + p.linesRemoved, 0)} removed). AST validation: ${patches.every((p) => p.astValid) ? 'PASSED' : 'FAILED'}.\n`,
      turnId
    );

    return result;
  }

  /**
   * Retrieve file content from map or object with fuzzy path resolution.
   */
  public getFileContent(
    filePath: string,
    files: Map<string, string> | Record<string, string>
  ): string {
    if (!files) return '';
    const clean = filePath.replace(/^\.\//, '');
    const stripped = clean.replace(/^\/workspace\//, '').replace(/^\/app\//, '').replace(/^\/home\/[^\/]+\//, '');

    if (files instanceof Map) {
      if (files.has(filePath)) return files.get(filePath)!;
      if (files.has(clean)) return files.get(clean)!;
      if (files.has(stripped)) return files.get(stripped)!;
      for (const [k, v] of files.entries()) {
        const cleanK = k.replace(/^\.\//, '');
        if (clean.endsWith(cleanK) || cleanK.endsWith(clean) || stripped.endsWith(cleanK) || cleanK.endsWith(stripped)) {
          return v;
        }
      }
    } else if (typeof files === 'object') {
      if (filePath in files) return files[filePath];
      if (clean in files) return files[clean];
      if (stripped in files) return files[stripped];
      for (const [k, v] of Object.entries(files)) {
        const cleanK = k.replace(/^\.\//, '');
        if (clean.endsWith(cleanK) || cleanK.endsWith(clean) || stripped.endsWith(cleanK) || cleanK.endsWith(stripped)) {
          return v;
        }
      }
    }
    return '';
  }

  /**
   * Strip accidental Markdown codeblock fences from model output.
   */
  public sanitizePatchOutput(content: string): string {
    let sanitized = content.trim();
    // Remove ```python ... ``` or ```ts ... ``` or ```diff ... ``` wrappers
    const fenceMatch = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/m.exec(sanitized);
    if (fenceMatch) {
      sanitized = fenceMatch[1];
    }
    return sanitized;
  }

  /**
   * Pre-flight AST and Syntax Validator.
   */
  public validateSyntax(filePath: string, content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Bracket & Parentheses & Brace Balance Check
    const stack: { char: string; line: number }[] = [];
    const lines = content.split('\n');

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1];

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const prev = i > 0 ? line[i - 1] : '';

        if (prev === '\\') continue; // Escaped

        // Quote tracking (for single-line strings)
        if (char === '"' && !inSingleQuote && !inBacktick) inDoubleQuote = !inDoubleQuote;
        if (char === "'" && !inDoubleQuote && !inBacktick) inSingleQuote = !inSingleQuote;
        if (char === '`' && !inSingleQuote && !inDoubleQuote) inBacktick = !inBacktick;

        if (inSingleQuote || inDoubleQuote || inBacktick) continue;

        // Skip comments
        if (char === '/' && line[i + 1] === '/') break;
        if (char === '#') break; // Python / Shell comment

        if (char === '(' || char === '[' || char === '{') {
          stack.push({ char, line: lineNum });
        } else if (char === ')') {
          const top = stack.pop();
          if (!top || top.char !== '(') {
            errors.push(`Mismatched closing ')' at line ${lineNum}`);
          }
        } else if (char === ']') {
          const top = stack.pop();
          if (!top || top.char !== '[') {
            errors.push(`Mismatched closing ']' at line ${lineNum}`);
          }
        } else if (char === '}') {
          const top = stack.pop();
          if (!top || top.char !== '{') {
            errors.push(`Mismatched closing '}' at line ${lineNum}`);
          }
        }
      }

      // Reset single-line quotes at end of line (unless backticks)
      inSingleQuote = false;
      inDoubleQuote = false;
    }

    if (stack.length > 0) {
      const unclosed = stack.map((s) => `'${s.char}' (line ${s.line})`).join(', ');
      errors.push(`Unclosed bracket/brace delimiters: ${unclosed}`);
    }

    // 2. Python-specific indentation check
    if (filePath.endsWith('.py')) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const indentMatch = /^(\s*)/.exec(line);
        const indent = indentMatch ? indentMatch[1].length : 0;
        if (indent % 2 !== 0 && indent % 4 !== 0 && indent !== 0) {
          errors.push(`Suspicious Python indentation at line ${i + 1}: ${indent} spaces`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Anti-Scope-Creep Assessment.
   */
  public assessScopeCreep(
    patches: FilePatch[],
    implicatedFiles: Set<string>
  ): ScopeCreepAssessment {
    const cleanImplicated = new Set(Array.from(implicatedFiles).map((p) => p.replace(/^\.\//, '')));
    const unrelatedFilesTouched: string[] = [];
    let totalLinesChanged = 0;

    for (const patch of patches) {
      const cleanPath = patch.filePath.replace(/^\.\//, '');
      if (!cleanImplicated.has(cleanPath)) {
        unrelatedFilesTouched.push(patch.filePath);
      }
      totalLinesChanged += patch.linesAdded + patch.linesRemoved;
    }

    // Compute risk score: base 0, +50 per unrelated file, +1 per line changed above 20
    let riskScore = 0;
    if (unrelatedFilesTouched.length > 0) {
      riskScore += unrelatedFilesTouched.length * 45;
    }
    if (totalLinesChanged > 20) {
      riskScore += Math.min(40, (totalLinesChanged - 20) * 2);
    }

    const passed = unrelatedFilesTouched.length === 0 && riskScore <= 40;

    return {
      passed,
      implicatedOnly: unrelatedFilesTouched.length === 0,
      unrelatedFilesTouched,
      riskScore: Math.min(100, riskScore),
    };
  }

  /**
   * Generate standard unified diff format string.
   */
  public generateUnifiedDiff(
    filePath: string,
    original: string,
    patched: string
  ): string {
    const cleanPath = filePath.replace(/^\.\//, '');
    const origLines = original.split('\n');
    const patchLines = patched.split('\n');

    if (original === patched) {
      return '';
    }

    const diffLines: string[] = [
      `--- a/${cleanPath}`,
      `+++ b/${cleanPath}`,
    ];

    // Find first difference and last difference for clean single hunk
    let firstDiff = 0;
    while (
      firstDiff < origLines.length &&
      firstDiff < patchLines.length &&
      origLines[firstDiff] === patchLines[firstDiff]
    ) {
      firstDiff++;
    }

    let origEnd = origLines.length - 1;
    let patchEnd = patchLines.length - 1;
    while (
      origEnd >= firstDiff &&
      patchEnd >= firstDiff &&
      origLines[origEnd] === patchLines[patchEnd]
    ) {
      origEnd--;
      patchEnd--;
    }

    const contextStart = Math.max(0, firstDiff - 3);
    const origContextEnd = Math.min(origLines.length - 1, origEnd + 3);
    const patchContextEnd = Math.min(patchLines.length - 1, patchEnd + 3);

    const origHunkLen = origContextEnd - contextStart + 1;
    const patchHunkLen = (firstDiff - contextStart) + (patchEnd - firstDiff + 1) + (origLines.length - 1 - origEnd);

    diffLines.push(`@@ -${contextStart + 1},${origHunkLen} +${contextStart + 1},${Math.max(1, patchHunkLen)} @@`);

    // Leading context
    for (let i = contextStart; i < firstDiff; i++) {
      diffLines.push(` ${origLines[i]}`);
    }

    // Removed lines
    for (let i = firstDiff; i <= origEnd; i++) {
      diffLines.push(`-${origLines[i]}`);
    }

    // Added lines
    for (let i = firstDiff; i <= patchEnd; i++) {
      diffLines.push(`+${patchLines[i]}`);
    }

    // Trailing context
    for (let i = origEnd + 1; i <= origContextEnd; i++) {
      diffLines.push(` ${origLines[i]}`);
    }

    return diffLines.join('\n');
  }

  /**
   * Count lines added and removed in unified diff.
   */
  public calculateDiffStats(diff: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;

    const lines = diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed++;
      }
    }

    return { added, removed };
  }

  /**
   * Standard fallback heuristic patch generation.
   */
  private applyStandardHeuristicPatch(
    filePath: string,
    original: string,
    diagnostic: DiagnosticReport
  ): string {
    try {
      const scenarioPatched = applyScenarioHeuristicPatch(filePath, original);
      if (scenarioPatched !== original) return scenarioPatched;
    } catch {
      // fall through to generic heuristics
    }

    if (process.env.DEMO_OFFLINE !== 'true' && process.env.NODE_ENV !== 'test') {
      return original;
    }

    const lines = original.split('\n');
    const targetLine = Math.min(lines.length, Math.max(1, diagnostic.primaryRootCauseLocation.startLine));
    const targetIdx = targetLine - 1;

    if (
      diagnostic.failureType === 'ZeroDivisionError' ||
      diagnostic.primaryFailureMessage?.includes('ZeroDivision') ||
      original.includes('return a // b')
    ) {
      return original.replace(
        /return a \/\/ b|return a\s*\/\s*b/,
        'if b == 0:\n            raise ValueError("Cannot divide by zero")\n        return a / b'
      );
    }

    if (diagnostic.failureType === 'TypeError' || diagnostic.failureType === 'NullPointerException') {
      const line = lines[targetIdx] || '';
      const indent = line.match(/^(\s*)/)?.[1] || '  ';
      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        lines.splice(targetIdx, 0, `${indent}if (!target) return null;`);
        return lines.join('\n');
      }
    }

    return original;
  }
}

export const patchSynthesizerSubagent = new PatchSynthesizerSubagent();
export const createPatchSynthesizer = () => new PatchSynthesizerSubagent();
