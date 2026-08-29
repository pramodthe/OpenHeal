/**
 * TrueForge Agent Harness Runtime Engine
 * Matching @truefoundry/trueforge-sdk & trueforge.dev/api/use-agent
 * Orchestrates Diagnostic, Patch Synthesizer, Regression Verifier & HITL Gates
 */

import type {
  AgentSessionConfig,
  ISandboxInstance,
  PullRequestResult,
  QodoScorecardResult,
  SessionState,
  TurnEvent,
  TurnEventDelta,
  TurnStreamOptions,
  UserToolApprovalDecision,
} from './types.ts';
import { sessionManager } from './session.ts';
import { eventBus, createTurnStream } from './event-bus.ts';
import { traceLocalStep } from './turn-tracer.ts';
import { hitlGate } from './hitl-gate.ts';
import { diagnosticSubagent } from './swarm/diagnostic.ts';
import { patchSynthesizerSubagent } from './swarm/patcher.ts';
import { regressionVerifierSubagent } from './swarm/verifier.ts';
import { calculateQodoScorecard } from '../qodo/scorecard.ts';
import { createPullRequestFromSession } from '../heal/github.ts';
import { destroySessionSandbox } from '../heal/sandbox-registry.ts';
import { resolveBundledScenarioDir } from '../heal/scenarios.ts';
import type { LLMConfig } from '../llm/provider.ts';

export interface HarnessExecutionOptions {
  sandbox?: ISandboxInstance;
  repoFiles?: Map<string, string> | Record<string, string>;
  baselineLog?: string;
  testCommand?: string;
  scenarioId?: string;
  qodoScorecard?: QodoScorecardResult;
  deferLoop?: boolean;
  llmConfig?: LLMConfig;
  prExecutor?: (payload: {
    sessionId: string;
    branch: string;
    title: string;
    body: string;
    diff: string;
  }) => Promise<PullRequestResult>;
}

export class TrueForgeHarness {
  /**
   * Start a new self-healing session and run the multi-agent orchestration loop.
   */
  public async startSession(
    config: Partial<AgentSessionConfig> & { repoUrl: string; sessionId?: string },
    options: HarnessExecutionOptions = {}
  ): Promise<SessionState> {
    const session = sessionManager.createSession(config);
    const sessionId = session.config.sessionId;
    const orchThreadId = sessionManager.createThread(sessionId, 'orchestrator');

    // Emit session started event
    eventBus.emitEvent(sessionId, orchThreadId, 'session.started', {
      sessionId,
      repoUrl: session.config.repoUrl,
      timestamp: session.createdAt,
    });

    eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message: 'TrueForge harness initialized. Provisioning execution pipeline...',
    });

    if (!options.deferLoop) {
      this.runAutonomousTurnLoop(sessionId, options).catch((err) => {
        console.error("[HARNESS] Error in runAutonomousTurnLoop:", err);
        sessionManager.transitionStatus(sessionId, 'FAILED', err.message);
        eventBus.emitEvent(sessionId, orchThreadId, 'session.error', {
          error: err.message,
        });
        eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
          sessionId,
          status: 'FAILED',
          durationMs: 0,
        });
        destroySessionSandbox(sessionId).catch(() => {});
      });
    }

    return session;
  }

  /**
   * Core Autonomous Turn Loop executing subagents with isolated thread scopes.
   */
  public async runAutonomousTurnLoop(
    sessionId: string,
    options: HarnessExecutionOptions = {}
  ): Promise<SessionState> {
    console.log(`[HARNESS] runAutonomousTurnLoop STARTING for ${sessionId}`);
    const session = sessionManager.getRequiredSession(sessionId);
    const maxAttempts = session.config.maxPatchAttempts ?? 3;
    const repoFiles = options.repoFiles || new Map<string, string>();
    let currentAttempt = session.currentAttempt || 0;

    const orchThreadId = sessionManager.createThread(sessionId, 'orchestrator');

    traceLocalStep(sessionId, orchThreadId, 'turn.created', {
      turn_id: `local_${sessionId}`,
      state: { status: 'running' },
    });

    // 1. CAPTURING_BASELINE / Baseline Ingestion
    console.log(`[HARNESS] State: CAPTURING_BASELINE`);
    sessionManager.transitionStatus(sessionId, 'CAPTURING_BASELINE');
    eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message: 'Capturing baseline test failure logs...',
    });

    let baselineLog = options.baselineLog || session.baselineLog || '';
    const testCommand =
      options.testCommand ||
      session.config.testCommandOverride ||
      this.inferTestCommand(session.config.language);

    if (!baselineLog && options.sandbox) {
      let stdout = '';
      let stderr = '';
      const baselineResult = await options.sandbox.streamCommand(
        testCommand,
        (chunk) => {
          stdout += chunk;
          eventBus.emitDelta(sessionId, orchThreadId, 'sandbox.log.delta', {
            stream: 'stdout',
            text: chunk,
          });
        },
        (chunk) => {
          stderr += chunk;
          eventBus.emitDelta(sessionId, orchThreadId, 'sandbox.log.delta', {
            stream: 'stderr',
            text: chunk,
          });
        }
      );
      baselineLog = `${baselineResult.stdout || stdout}\n${baselineResult.stderr || stderr}`.trim();
      sessionManager.updateSession(sessionId, { baselineLog });
      eventBus.emitEvent(sessionId, orchThreadId, 'test.result', {
        phase: 'baseline',
        exitCode: baselineResult.exitCode,
        summary: `Baseline test executed with exit code ${baselineResult.exitCode}`,
      });

      if (baselineResult.exitCode === 0) {
        sessionManager.transitionStatus(sessionId, 'FAILED', 'Baseline tests already pass; nothing to heal.');
        eventBus.emitEvent(sessionId, orchThreadId, 'session.error', {
          error: 'Baseline tests already pass; nothing to heal.',
        });
        eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
          sessionId,
          status: 'FAILED',
          durationMs: Date.now() - new Date(session.createdAt).getTime(),
        });
        await destroySessionSandbox(sessionId);
        return sessionManager.getRequiredSession(sessionId);
      }
    }

    if (!baselineLog) {
      sessionManager.transitionStatus(sessionId, 'FAILED', 'No baseline test log was captured.');
      eventBus.emitEvent(sessionId, orchThreadId, 'session.error', {
        error: 'No baseline test log was captured. Provide a sandbox or a failing test log.',
      });
      eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
        sessionId,
        status: 'FAILED',
        durationMs: Date.now() - new Date(session.createdAt).getTime(),
      });
      await destroySessionSandbox(sessionId);
      return sessionManager.getRequiredSession(sessionId);
    }

    // 2. DIAGNOSING (Subagent 1: Diagnostic)
    console.log(`[HARNESS] State: DIAGNOSING`);
    sessionManager.transitionStatus(sessionId, 'DIAGNOSING');
    const diagThreadId = sessionManager.createThread(sessionId, 'diagnostic', currentAttempt + 1);

    traceLocalStep(sessionId, diagThreadId, 'thread.created', {
      thread_id: diagThreadId,
      title: 'diagnostic',
    }, 'Subagent started: diagnostic');

    eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
      agent: 'diagnostic',
      status: 'running',
      message: 'Diagnostic subagent analyzing stack traces and localizing AST nodes...',
    });

    const diagnosticReport = await diagnosticSubagent.diagnose(
      sessionId,
      diagThreadId,
      baselineLog,
      repoFiles,
      session.config.repoUrl
    );

    sessionManager.setDiagnosticReport(sessionId, diagnosticReport);

    eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
      agent: 'diagnostic',
      status: 'completed',
      message: `Diagnostic complete: ${diagnosticReport.failureType} at ${diagnosticReport.primaryRootCauseLocation.filePath}:${diagnosticReport.primaryRootCauseLocation.startLine}`,
    });

    traceLocalStep(sessionId, diagThreadId, 'thread.done', {
      thread_id: diagThreadId,
      title: 'diagnostic',
      state: { status: 'done' },
    }, `Subagent done: diagnostic → ${diagnosticReport.failureType}`);

    // Iterative Synthesis & Verification Loop
    let verifiedSuccessfully = false;

    while (currentAttempt < maxAttempts && !verifiedSuccessfully) {
      currentAttempt++;
      sessionManager.updateSession(sessionId, { currentAttempt });

      // 3. SYNTHESIZING (Subagent 2: Patch Synthesizer)
      sessionManager.transitionStatus(sessionId, 'SYNTHESIZING');
      const patchThreadId = sessionManager.createThread(sessionId, 'patcher', currentAttempt);

      eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
        agent: 'patcher',
        status: 'running',
        message: `Patch Synthesizer generating minimal code fix (attempt #${currentAttempt})...`,
      });

      const patchResult = await patchSynthesizerSubagent.synthesizePatch(
        sessionId,
        patchThreadId,
        diagnosticReport,
        repoFiles,
        currentAttempt,
        undefined,
        options.llmConfig,
        options.scenarioId
      );

      sessionManager.recordPatchResult(sessionId, patchResult);

      eventBus.emitEvent(sessionId, orchThreadId, 'patch.generated', {
        diff: patchResult.combinedUnifiedDiff,
        filesChanged: patchResult.patches.map((p) => p.filePath),
        result: patchResult,
      });

      eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
        agent: 'patcher',
        status: 'completed',
        message: `Patch synthesized. Anti-scope-creep risk score: ${patchResult.scopeCreepAssessment.riskScore}/100.`,
      });

      // Apply patches into sandbox / memory
      for (const patch of patchResult.patches) {
        if (repoFiles instanceof Map) {
          repoFiles.set(patch.filePath, patch.patchedContent);
        } else if (typeof repoFiles === 'object') {
          repoFiles[patch.filePath] = patch.patchedContent;
        }

        if (options.sandbox) {
          await options.sandbox.uploadFile(patch.filePath, patch.patchedContent);
        }
      }

      // 4. VERIFYING (Subagent 3: Regression Verifier)
      sessionManager.transitionStatus(sessionId, 'VERIFYING');
      const verifThreadId = sessionManager.createThread(sessionId, 'verifier', currentAttempt);

      eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
        agent: 'verifier',
        status: 'running',
        message: `Regression Verifier executing sandbox test suite (attempt #${currentAttempt})...`,
      });

      let verificationReport;
      if (options.sandbox) {
        verificationReport = await regressionVerifierSubagent.verify({
          sessionId,
          threadId: verifThreadId,
          sandbox: options.sandbox,
          testCommand,
          attemptNumber: currentAttempt,
          previouslyFailingTests: diagnosticReport.failingTests,
        });
      } else {
        sessionManager.transitionStatus(sessionId, 'FAILED', 'No sandbox available to verify the patch.');
        eventBus.emitEvent(sessionId, orchThreadId, 'session.error', {
          error: 'Regression verification requires a sandbox instance.',
        });
        eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
          sessionId,
          status: 'FAILED',
          durationMs: Date.now() - new Date(session.createdAt).getTime(),
        });
        await destroySessionSandbox(sessionId);
        return sessionManager.getRequiredSession(sessionId);
      }

      sessionManager.recordVerificationResult(sessionId, verificationReport);

      if (verificationReport.overallStatus === 'PASSED') {
        verifiedSuccessfully = true;
        eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
          agent: 'verifier',
          status: 'completed',
          message: 'All verification tests passed (100% green build).',
        });
      } else {
        eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
          agent: 'verifier',
          status: 'failed',
          message: `Verification attempt #${currentAttempt} failed (${verificationReport.failedCount} failing tests). Retrying...`,
        });
      }
    }

    if (!verifiedSuccessfully) {
      sessionManager.transitionStatus(sessionId, 'FAILED', 'Max patch attempts exceeded without passing verification.');
      eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
        sessionId,
        status: 'FAILED',
        durationMs: Date.now() - new Date(session.createdAt).getTime(),
      });
      await destroySessionSandbox(sessionId);
      return sessionManager.getRequiredSession(sessionId);
    }

    const latest = sessionManager.getRequiredSession(sessionId);
    const scorecard: QodoScorecardResult = options.qodoScorecard || this.buildScorecard(latest);
    sessionManager.setQodoScorecard(sessionId, scorecard);
    eventBus.emitEvent(sessionId, orchThreadId, 'qodo.scorecard', scorecard);

    // Bundled lab fixtures have no real GitHub repo — stop after a green verify.
    if (options.scenarioId && resolveBundledScenarioDir(options.scenarioId)) {
      sessionManager.transitionStatus(sessionId, 'COMPLETED');
      eventBus.emitEvent(sessionId, orchThreadId, 'agent.status', {
        agent: 'orchestrator',
        status: 'completed',
        message: 'Lab scenario healed — all tests pass. No PR opened for bundled fixtures.',
      });
      eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
        sessionId,
        status: 'COMPLETED',
        durationMs: Date.now() - new Date(session.createdAt).getTime(),
      });
      traceLocalStep(sessionId, orchThreadId, 'turn.done', {
        state: { status: 'done', output: { content: 'Lab scenario healed' } },
      });
      await destroySessionSandbox(sessionId);
      return sessionManager.getRequiredSession(sessionId);
    }

    // 5. PRIVILEGED TOOL INTERCEPTION & HITL APPROVAL GATE
    const activePatch = sessionManager.getRequiredSession(sessionId).activePatch;
    const toolCallId = `call_gh_pr_${Date.now()}`;
    const prParams = {
      title: `fix(${diagnosticReport.frameworkDetected}): resolve ${diagnosticReport.failureType}`,
      branch: `openheal/fix-${sessionId.slice(0, 8)}`,
      body: `### OpenHeal Self-Healing Report\n\n- **Root Cause**: ${diagnosticReport.failureType} at \`${diagnosticReport.primaryRootCauseLocation.filePath}:${diagnosticReport.primaryRootCauseLocation.startLine}\`\n- **Fix**: Applied minimal boundary check.\n- **Qodo Quality Score**: ${scorecard.overallScore}/100\n- **Verification**: 100% green tests.`,
    };

    if (session.config.autoApprovePR) {
      // Auto-approve mode
      console.log(`[HARNESS] Auto-approving PR`);
      sessionManager.transitionStatus(sessionId, 'EXECUTING_PR');
      await this.executePullRequest(sessionId, orchThreadId, prParams, activePatch?.combinedUnifiedDiff || '', options.prExecutor);
    } else {
      // HITL Pause
      console.log(`[HARNESS] Pausing for HITL Gate`);
      hitlGate.createApprovalRequest(
        sessionId,
        orchThreadId,
        `turn_hitl_${Date.now()}`,
        toolCallId,
        'github_mcp_create_pull_request',
        prParams,
        {
          proposedPatch: activePatch?.combinedUnifiedDiff,
          scorecard,
        }
      );
      // Execution pauses here until resumeWithApproval is called
    }

    return sessionManager.getRequiredSession(sessionId);
  }

  /**
   * Resume paused turn loop upon receiving human operator approval or denial.
   */
  public async resumeWithApproval(
    sessionId: string,
    resumeToken: string,
    decision: UserToolApprovalDecision,
    prExecutor?: HarnessExecutionOptions['prExecutor']
  ): Promise<{ success: boolean; sessionState: SessionState; error?: string }> {
    const resolution = hitlGate.resolveApproval({
      sessionId,
      resumeToken,
      decision,
    });

    if (!resolution.success) {
      return {
        success: false,
        sessionState: sessionManager.getRequiredSession(sessionId),
        error: resolution.error,
      };
    }

    const state = sessionManager.getRequiredSession(sessionId);
    const orchThreadId = sessionManager.createThread(sessionId, 'orchestrator');

    if (decision.status === 'allow') {
      // Note: this path is the local fallback only. When TrueForge owns the run,
      // approvals resolve through heal-agent.resolveHarnessApproval instead.
      const activePatch = state.activePatch?.combinedUnifiedDiff || '';
      const params = resolution.modifiedParameters || {
        title: `fix: auto-heal session ${sessionId.slice(0, 8)}`,
        branch: `openheal/fix-${sessionId.slice(0, 8)}`,
        body: 'Automated self-healing patch generated by OpenHeal.',
      };

      await this.executePullRequest(
        sessionId,
        orchThreadId,
        params as { title: string; branch: string; body: string },
        activePatch,
        prExecutor
      );
    } else {
      // Rejected
      sessionManager.transitionStatus(sessionId, 'REJECTED', decision.reason || 'Denied by human operator');
      eventBus.emitEvent(sessionId, orchThreadId, 'session.completed', {
        sessionId,
        status: 'rejected',
        durationMs: Date.now() - new Date(state.createdAt).getTime(),
      });
      await destroySessionSandbox(sessionId);
    }

    return {
      success: true,
      sessionState: sessionManager.getRequiredSession(sessionId),
    };
  }

  /**
   * Execute Pull Request creation after approval.
   */
  private async executePullRequest(
    sessionId: string,
    threadId: string,
    params: { title: string; branch: string; body: string },
    diff: string,
    prExecutor?: HarnessExecutionOptions['prExecutor']
  ): Promise<void> {
    const startTime = Date.now();

    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message: `Creating GitHub Pull Request on branch "${params.branch}"...`,
    });

    let prResult: PullRequestResult;
    let prWarning: string | undefined;

    if (prExecutor) {
      prResult = await prExecutor({
        sessionId,
        branch: params.branch,
        title: params.title,
        body: params.body,
        diff,
      });
    } else {
      const latest = sessionManager.getRequiredSession(sessionId);
      const created = await createPullRequestFromSession(latest, {
        resumeToken: latest.hitlApproval?.resumeToken,
      });
      prResult = created.result;
      prWarning = created.warning;
    }

    if (prWarning) {
      eventBus.emitDelta(sessionId, threadId, 'sandbox.log.delta', {
        stream: 'stdout',
        text: `[github] ${prWarning}\n`,
      });
      eventBus.emitEvent(sessionId, threadId, 'agent.status', {
        agent: 'orchestrator',
        status: 'running',
        message: prWarning,
      });
    }

    sessionManager.setPullRequest(sessionId, prResult);
    sessionManager.transitionStatus(sessionId, 'COMPLETED');

    eventBus.emitEvent(sessionId, threadId, 'github.pr_created', {
      prUrl: prResult.prUrl,
      prNumber: prResult.prNumber,
      branch: prResult.branchName,
    });

    eventBus.emitEvent(sessionId, threadId, 'session.completed', {
      sessionId,
      status: 'healed',
      durationMs: Date.now() - startTime,
    });
    await destroySessionSandbox(sessionId);
  }

  private buildScorecard(state: SessionState): QodoScorecardResult {
    const patch = state.activePatch?.patches[0];
    const report = calculateQodoScorecard({
      originalCode: patch?.originalContent || '',
      healedCode: patch?.patchedContent || '',
      diff: state.activePatch?.combinedUnifiedDiff || '',
      filePath: patch?.filePath,
      language: state.config.language || 'python',
      testResults: {
        passed: state.latestVerification?.overallStatus === 'PASSED',
        exitCode: state.latestVerification?.exitCode,
        testOutput: state.latestVerification?.stdoutExcerpt,
      },
      generatedTestsCount: state.latestVerification?.passedCount || 0,
      diagnosticFinding: state.diagnosticReport?.primaryFailureMessage,
    });
    return report as unknown as QodoScorecardResult;
  }

  /**
   * Helper to create turn streams matching trueforge.dev/api/use-agent.
   */
  public createTurnStream(
    options: TurnStreamOptions
  ): AsyncIterable<TurnEvent | TurnEventDelta> {
    return createTurnStream(options);
  }

  private inferTestCommand(language?: string): string {
    switch (language) {
      case 'python':
        return 'PYTHONPATH=. python3 -m pytest -v tests/ || python3 -m unittest discover -s tests -v';
      case 'node':
        return 'node --experimental-strip-types --test tests/cache.test.ts || npm test';
      case 'cargo':
      case 'rust':
        return 'cargo test -- --nocapture';
      case 'go':
        return 'go test ./...';
      default:
        return 'npm test';
    }
  }
}

export const harness = new TrueForgeHarness();
export const createHarness = () => new TrueForgeHarness();
