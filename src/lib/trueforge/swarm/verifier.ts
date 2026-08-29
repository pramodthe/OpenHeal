/**
 * TrueForge Regression Verifier Subagent (thread_verifier_xxx)
 * Sandbox verification orchestrator, flaky test guard & regression delta analyzer.
 */

import type {
  BaselineComparison,
  FlakyTestDetails,
  ISandboxInstance,
  OverallVerificationStatus,
  TestCaseResult,
  VerificationReport,
} from '../types.ts';
import { eventBus } from '../event-bus.ts';

export interface VerifyOptions {
  sessionId: string;
  threadId: string;
  sandbox: ISandboxInstance;
  testCommand: string;
  attemptNumber: number;
  previouslyFailingTests?: string[];
  enableFlakyGuard?: boolean;
  maxFlakyReruns?: number;
  timeoutMs?: number;
}

export class RegressionVerifierSubagent {
  /**
   * Run comprehensive sandbox verification suite and compute regression matrix.
   */
  public async verify(options: VerifyOptions): Promise<VerificationReport> {
    const {
      sessionId,
      threadId,
      sandbox,
      testCommand,
      attemptNumber,
      previouslyFailingTests = [],
      enableFlakyGuard = true,
      maxFlakyReruns = 2,
      timeoutMs = 60000,
    } = options;

    const startTime = Date.now();
    const turnId = `turn_verif_${Date.now()}`;

    eventBus.emitEvent(sessionId, threadId, 'verification.started', {
      threadId,
      testCommand,
      attemptNumber,
      timestamp: new Date().toISOString(),
    }, turnId);

    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      `Executing test verification run #${attemptNumber}: "${testCommand}" in sandbox...\n`,
      turnId
    );

    // 1. Primary Test Run Execution with live log streaming
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const runResult = await sandbox.streamCommand(
      testCommand,
      (chunk) => {
        stdoutBuffer += chunk;
        eventBus.emitDelta(
          sessionId,
          threadId,
          'sandbox.log.delta',
          { stream: 'stdout', text: chunk },
          turnId
        );
      },
      (chunk) => {
        stderrBuffer += chunk;
        eventBus.emitDelta(
          sessionId,
          threadId,
          'sandbox.log.delta',
          { stream: 'stderr', text: chunk },
          turnId
        );
      }
    );

    const primaryExitCode = runResult.exitCode;
    const combinedLogs = stdoutBuffer + '\n' + stderrBuffer;

    // 2. Parse Test Outcomes
    const parsedOutcome = this.parseTestOutput(combinedLogs, primaryExitCode);

    // 3. Flaky Test Guard & Re-runs
    const flakyDetails: FlakyTestDetails = {
      detected: false,
      flakyTests: [],
      rerunCount: 0,
    };

    if (enableFlakyGuard && primaryExitCode === 0 && maxFlakyReruns > 1) {
      for (let i = 1; i < maxFlakyReruns; i++) {
        flakyDetails.rerunCount++;
        const rerunResult = await sandbox.executeCommand(testCommand, { timeoutMs });
        if (rerunResult.exitCode !== 0) {
          flakyDetails.detected = true;
          const rerunParsed = this.parseTestOutput(rerunResult.stdout + '\n' + rerunResult.stderr, rerunResult.exitCode);
          flakyDetails.flakyTests.push(...rerunParsed.failingTestNames);
        }
      }
    }

    // 4. Baseline Delta Comparison
    const baselineComparison = this.computeBaselineComparison(
      previouslyFailingTests,
      parsedOutcome.failingTestNames,
      parsedOutcome.passingTestNames
    );

    // 5. Determine Overall Status
    let overallStatus: OverallVerificationStatus = 'PASSED';
    if (primaryExitCode !== 0 || parsedOutcome.failedCount > 0 || baselineComparison.stillFailing.length > 0) {
      overallStatus = 'FAILED';
    } else if (flakyDetails.detected) {
      overallStatus = 'FLAKY';
    }

    const durationMs = Date.now() - startTime;

    const report: VerificationReport = {
      sessionId,
      threadId,
      attemptNumber,
      overallStatus,
      exitCode: primaryExitCode,
      durationMs,
      totalTests: parsedOutcome.totalTests,
      passedCount: parsedOutcome.passedCount,
      failedCount: parsedOutcome.failedCount,
      skippedCount: parsedOutcome.skippedCount,
      baselineComparison,
      flakyTestDetails: flakyDetails,
      stdoutExcerpt: stdoutBuffer.slice(-2000),
      stderrExcerpt: stderrBuffer.slice(-2000),
      testResults: parsedOutcome.testCases,
    };

    eventBus.emitEvent(sessionId, threadId, 'test.result', {
      phase: 'verification',
      exitCode: primaryExitCode,
      summary: `${overallStatus}: ${parsedOutcome.passedCount} passed, ${parsedOutcome.failedCount} failed of ${parsedOutcome.totalTests} tests.`,
    }, turnId);

    eventBus.emitEvent(sessionId, threadId, 'verification.completed', report, turnId);

    eventBus.emitDelta(
      sessionId,
      threadId,
      'agent.thought.delta',
      `Verification complete: ${overallStatus} (${parsedOutcome.passedCount}/${parsedOutcome.totalTests} passing). ` +
        `Previously failing resolved: [${baselineComparison.previouslyFailingNowPassing.join(', ')}]. ` +
        `New regressions: ${baselineComparison.newRegressions.length}.\n`,
      turnId
    );

    return report;
  }

  /**
   * Parse test output lines into structured counts and test cases.
   */
  public parseTestOutput(
    output: string,
    exitCode: number
  ): {
    totalTests: number;
    passedCount: number;
    failedCount: number;
    skippedCount: number;
    passingTestNames: string[];
    failingTestNames: string[];
    testCases: TestCaseResult[];
  } {
    const testCases: TestCaseResult[] = [];
    const passingTestNames: string[] = [];
    const failingTestNames: string[] = [];

    // Pytest match: 3 passed, 1 failed or === 5 passed in 0.12s ===
    const pytestPassedMatch = /(\d+)\s+passed/i.exec(output);
    const pytestFailedMatch = /(\d+)\s+failed/i.exec(output);
    const pytestSkippedMatch = /(\d+)\s+skipped/i.exec(output);

    // Jest match: Tests: 1 failed, 4 passed, 5 total
    const jestTestsMatch = /Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/i.exec(output);

    // Cargo match: test result: FAILED. 4 passed; 1 failed; 0 ignored
    const cargoMatch = /test result:\s*(?:ok|FAILED)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/i.exec(output);

    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Node.js test runner summary: "# pass 2" / "# fail 1"
    const nodePassMatch = /#\s*pass\s+(\d+)/i.exec(output);
    const nodeFailMatch = /#\s*fail\s+(\d+)/i.exec(output);
    if (nodePassMatch || nodeFailMatch) {
      if (nodePassMatch) passedCount = parseInt(nodePassMatch[1], 10);
      if (nodeFailMatch) failedCount = parseInt(nodeFailMatch[1], 10);
    } else if (pytestPassedMatch || pytestFailedMatch) {
      if (pytestPassedMatch) passedCount = parseInt(pytestPassedMatch[1], 10);
      if (pytestFailedMatch) failedCount = parseInt(pytestFailedMatch[1], 10);
      if (pytestSkippedMatch) skippedCount = parseInt(pytestSkippedMatch[1], 10);
    } else if (jestTestsMatch) {
      if (jestTestsMatch[1]) failedCount = parseInt(jestTestsMatch[1], 10);
      if (jestTestsMatch[2]) skippedCount = parseInt(jestTestsMatch[2], 10);
      if (jestTestsMatch[3]) passedCount = parseInt(jestTestsMatch[3], 10);
    } else if (cargoMatch) {
      passedCount = parseInt(cargoMatch[1], 10);
      failedCount = parseInt(cargoMatch[2], 10);
      skippedCount = parseInt(cargoMatch[3], 10);
    } else {
      // Fallback heuristics based on exitCode
      if (exitCode === 0) {
        passedCount = 1;
        failedCount = 0;
      } else {
        passedCount = 0;
        failedCount = 1;
      }
    }

    // Extract individual test names if available
    const passedRegex = /(?:PASSED|✓|ok)\s+([^\s\n]+)/g;
    let match;
    while ((match = passedRegex.exec(output)) !== null) {
      passingTestNames.push(match[1]);
      testCases.push({
        testId: match[1],
        name: match[1],
        status: 'passed',
        durationMs: 10,
      });
    }

    const failedRegex = /(?:FAILED|✕|FAIL:)\s+([^\s\n]+)/g;
    while ((match = failedRegex.exec(output)) !== null) {
      failingTestNames.push(match[1]);
      testCases.push({
        testId: match[1],
        name: match[1],
        status: 'failed',
        durationMs: 10,
        errorMessage: 'Test execution failed',
      });
    }

    const totalTests = Math.max(passedCount + failedCount + skippedCount, testCases.length, 1);

    return {
      totalTests,
      passedCount,
      failedCount,
      skippedCount,
      passingTestNames: [...new Set(passingTestNames)],
      failingTestNames: [...new Set(failingTestNames)],
      testCases,
    };
  }

  /**
   * Compute baseline vs. verification delta matrix.
   */
  public computeBaselineComparison(
    previouslyFailing: string[],
    currentFailing: string[],
    currentPassing: string[]
  ): BaselineComparison {
    const currentFailingSet = new Set(currentFailing);

    const previouslyFailingNowPassing: string[] = [];
    const stillFailing: string[] = [];
    const newRegressions: string[] = [];

    for (const test of previouslyFailing) {
      if (!currentFailingSet.has(test)) {
        previouslyFailingNowPassing.push(test);
      } else {
        stillFailing.push(test);
      }
    }

    // If current failing tests were not in baseline, they are new regressions
    const prevSet = new Set(previouslyFailing);
    for (const test of currentFailing) {
      if (!prevSet.has(test)) {
        newRegressions.push(test);
      }
    }

    return {
      previouslyFailingNowPassing,
      newRegressions,
      stillFailing,
    };
  }
}

export const regressionVerifierSubagent = new RegressionVerifierSubagent();
export const createRegressionVerifier = () => new RegressionVerifierSubagent();
