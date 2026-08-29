/**
 * TrueForge Agent Harness Runtime & Subagent Swarm TypeScript Definitions
 * Matching @truefoundry/trueforge-sdk & trueforge.dev/api/use-agent
 */

// ============================================================================
// Core Session & Harness Types
// ============================================================================

export type SessionStatus =
  | 'INIT'
  | 'PROVISIONING_SANDBOX'
  | 'BUILDING'
  | 'EXPLORING'
  | 'CAPTURING_BASELINE'
  | 'DIAGNOSING'
  | 'SYNTHESIZING'
  | 'VERIFYING'
  | 'AWAITING_HUMAN_APPROVAL'
  | 'EXECUTING_PR'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED';

export interface AgentSessionConfig {
  sessionId: string;
  repoUrl: string;
  targetBranch?: string;
  targetCommit?: string;
  maxPatchAttempts?: number;
  testCommandOverride?: string;
  autoApprovePR?: boolean; // false by default (HITL enforced)
  qodoScoreThreshold?: number; // default 70
  workspaceId?: string;
  language?: 'python' | 'node' | 'go' | 'rust' | 'generic';
  sandboxTimeoutMs?: number;
  [key: string]: unknown;
}

export interface HitlApprovalState {
  resumeToken: string;
  toolCallId: string;
  requestedAt: string;
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  decision?: {
    approver?: string;
    decidedAt: string;
    reason?: string;
    modifiedParameters?: Record<string, unknown>;
  };
}

export interface PullRequestResult {
  prNumber: number;
  prUrl: string;
  branchName: string;
  title: string;
  body: string;
}

export interface SessionState {
  config: AgentSessionConfig;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  sandboxWorkspaceId?: string;
  baselineLog?: string;
  diagnosticReport?: DiagnosticReport;
  currentAttempt: number;
  patchHistory: PatchSynthesisResult[];
  activePatch?: PatchSynthesisResult;
  verificationHistory: VerificationReport[];
  latestVerification?: VerificationReport;
  qodoScorecard?: QodoScorecardResult;
  hitlApproval?: HitlApprovalState;
  pullRequest?: PullRequestResult;
  errorMessage?: string;
}

// ============================================================================
// Subagent 1: Diagnostic Subagent Types
// ============================================================================

export type AstNodeType =
  | 'FunctionDeclaration'
  | 'MethodDefinition'
  | 'ClassDeclaration'
  | 'VariableDeclaration'
  | 'BlockStatement'
  | 'ExpressionStatement'
  | 'ReturnStatement'
  | 'StructDeclaration'
  | 'ImplBlock'
  | 'Unknown';

export interface SourceLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  symbolName?: string;
  nodeType?: AstNodeType;
  codeSnippet: string;
}

export interface FailureFrame {
  frameIndex: number;
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  functionName?: string;
  isWorkspaceFile: boolean;
  rawLineText: string;
}

export interface RootCauseHypothesis {
  id: string;
  title: string;
  description: string;
  confidenceScore: number; // 0.0 to 1.0
  implicatedLocations: SourceLocation[];
  suggestedFixDirection: string;
}

export type SupportedFramework =
  | 'pytest'
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'cargo'
  | 'gotest'
  | 'generic';

export interface DiagnosticReport {
  sessionId: string;
  threadId: string;
  timestamp: string;
  targetRepoUrl: string;
  frameworkDetected: SupportedFramework;
  failureCount: number;
  failingTests: string[];
  failureType: string; // e.g. "ZeroDivisionError", "AssertionError", "TypeError"
  primaryFailureMessage: string;
  stackTraceFrames: FailureFrame[];
  primaryRootCauseLocation: SourceLocation;
  secondaryLocations: SourceLocation[];
  hypotheses: RootCauseHypothesis[];
  rawLogExcerpt: string;
}

// ============================================================================
// Subagent 2: Patch Synthesizer Subagent Types
// ============================================================================

export interface FilePatch {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff: string; // Unified diff string format
  linesAdded: number;
  linesRemoved: number;
  astValid: boolean;
  syntaxErrors: string[];
}

export interface ScopeCreepAssessment {
  passed: boolean;
  implicatedOnly: boolean;
  unrelatedFilesTouched: string[];
  riskScore: number; // 0 to 100
}

export interface PatchSynthesisResult {
  sessionId: string;
  threadId: string;
  attemptNumber: number;
  patchPlan: string;
  rationale: string;
  patches: FilePatch[];
  combinedUnifiedDiff: string;
  isMinimal: boolean;
  scopeCreepAssessment: ScopeCreepAssessment;
  synthesisDurationMs: number;
}

// ============================================================================
// Subagent 3: Regression Verifier Subagent Types
// ============================================================================

export type TestResultStatus = 'passed' | 'failed' | 'skipped' | 'flaky';

export interface TestCaseResult {
  testId: string;
  name: string;
  status: TestResultStatus;
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
}

export interface BaselineComparison {
  previouslyFailingNowPassing: string[];
  newRegressions: string[];
  stillFailing: string[];
}

export interface FlakyTestDetails {
  detected: boolean;
  flakyTests: string[];
  rerunCount: number;
}

export type OverallVerificationStatus =
  | 'PASSED'
  | 'FAILED'
  | 'FLAKY'
  | 'TIMEOUT'
  | 'EXEC_ERROR';

export interface VerificationReport {
  sessionId: string;
  threadId: string;
  attemptNumber: number;
  overallStatus: OverallVerificationStatus;
  exitCode: number;
  durationMs: number;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  baselineComparison: BaselineComparison;
  flakyTestDetails: FlakyTestDetails;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  testResults?: TestCaseResult[];
}

// ============================================================================
// HITL Approval Gate Contracts
// ============================================================================

export interface ToolApprovalRequestPayload {
  sessionId: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  resumeToken: string;
  createdAt: number;
  expiresAt: number;
  proposedPatch?: string;
  scorecard?: QodoScorecardResult;
}

export interface ToolApprovalRequiredPayload {
  toolCallId: string;
  toolName: 'github_mcp_create_pull_request' | 'git_push' | string;
  parameters: Record<string, unknown>;
  resumeToken: string;
  proposedPatch?: string;
  scorecard?: QodoScorecardResult;
  timestamp: string;
}

export interface UserToolApprovalDecision {
  status: 'allow' | 'deny';
  reason?: string;
  approver?: string;
  modifiedParameters?: Record<string, unknown>;
}

export interface UserToolApprovalPayload {
  sessionId: string;
  resumeToken: string;
  decision: UserToolApprovalDecision;
}

export interface UserToolApprovalInput {
  resumeToken: string;
  status: 'allow' | 'deny';
  reviewerFeedback?: string;
  modifiedParameters?: Record<string, unknown>;
}

// ============================================================================
// Turn Stream & Event Protocol (@truefoundry/trueforge-sdk)
// ============================================================================

export interface TurnEvent<T = unknown> {
  type: string;
  sessionId: string;
  threadId: string;
  turnId?: string;
  timestamp: string;
  payload: T;
  id?: string;
}

export interface TurnEventDelta<T = string | Record<string, unknown>> {
  type: string;
  sessionId: string;
  threadId: string;
  turnId?: string;
  delta: T;
  isDelta: true;
  id?: string;
}

export interface TurnStreamOptions {
  sessionId: string;
  threadId?: string;
  onEvent?: (event: TurnEvent) => void;
  onDelta?: (delta: TurnEventDelta) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

// ============================================================================
// Qodo CLI & Scorecard Contracts
// ============================================================================

import type { QodoGrade, QodoVerdict } from '../qodo/types.ts';

export interface QodoScorecardResult {
  overallScore: number; // 0 - 100
  qualityScore: number; // 0 - 100
  securityScore: number; // 0 - 100
  coverageScore: number; // 0 - 100
  performanceScore: number; // 0 - 100
  breakdown: {
    ruleViolations: string[];
    securityRisks: string[];
    complexityIndex: number;
    synthesizedTests: number;
  };
  passed: boolean;
  badgeUrl?: string;
  summary?: string;
  grade?: QodoGrade;
  verdict?: QodoVerdict;
  markdownSummary?: string;
}

// ============================================================================
// Sandbox Interface Contracts
// ============================================================================

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ISandboxInstance {
  id: string;
  language: 'python' | 'node' | 'go' | 'rust' | 'generic';
  executeCommand(
    cmd: string,
    options?: { timeoutMs?: number; env?: Record<string, string> }
  ): Promise<CommandResult>;
  streamCommand(
    cmd: string,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void
  ): Promise<CommandResult>;
  uploadFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  destroy(): Promise<void>;
}

// ============================================================================
// SSE Wire Protocol (TrueForge ↔ Web UI)
// ============================================================================

export type SSEEvent =
  | { type: 'session.started'; payload: { sessionId: string; repoUrl: string } }
  | {
      type: 'agent.status';
      payload: {
        agent: 'diagnostic' | 'patcher' | 'verifier' | 'qodo' | 'orchestrator';
        status: 'running' | 'completed' | 'failed';
        message: string;
      };
    }
  | { type: 'agent.thought.delta'; payload: { delta: string } }
  | { type: 'agent.thought'; payload: { completeThought: string } }
  | {
      type: 'sandbox.log.delta';
      payload: { stream: 'stdout' | 'stderr'; text: string };
    }
  | {
      type: 'patch.generated' | 'patch.synthesized';
      payload: { diff: string; filesChanged: string[]; result?: PatchSynthesisResult };
    }
  | {
      type: 'test.result';
      payload: {
        phase: 'baseline' | 'verification';
        exitCode: number;
        summary: string;
      };
    }
  | { type: 'qodo.scorecard'; payload: QodoScorecardResult }
  | { type: 'tool.approval_required'; payload: ToolApprovalRequiredPayload }
  | {
      type: 'tool.approval_resolved';
      payload: { status: 'allow' | 'deny'; timestamp: string; reason?: string };
    }
  | {
      type: 'github.pr_created';
      payload: { prUrl: string; prNumber: number; branch: string };
    }
  | {
      type: 'session.completed';
      payload: {
        sessionId: string;
        status: 'healed' | 'rejected' | 'failed' | 'SUCCESS' | 'FAILED';
        durationMs: number;
      };
    }
  | { type: 'session.error'; payload: { error: string } };
