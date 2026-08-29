/**
 * OpenHeal E2E Test Suite - Core Interface Contracts & Domain Types
 * Derived from PROJECT.md, TEST_INFRA.md, and Spec Miner Surveys 1-3.
 */

// ---------------------------------------------------------------------------
// TrueForge Harness & Subagent Swarm Contracts (F01 - F07)
// ---------------------------------------------------------------------------

export type AgentRole = 'orchestrator' | 'diagnostic' | 'patcher' | 'verifier' | 'qodo';
export type SessionStatus = 'IDLE' | 'INGESTING' | 'DIAGNOSING' | 'SYNTHESIZING' | 'VERIFYING' | 'AWAITING_APPROVAL' | 'APPLYING_PR' | 'COMPLETED' | 'FAILED' | 'REJECTED';
export type SupportedLanguage = 'python' | 'node' | 'go' | 'rust';

export interface SourceLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  symbolName?: string;
  nodeType?: 'FunctionDeclaration' | 'MethodDefinition' | 'ClassDeclaration' | 'VariableDeclaration' | 'BlockStatement' | 'ExpressionStatement' | 'ReturnStatement';
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

export interface DiagnosticReport {
  sessionId: string;
  threadId: string;
  timestamp: string;
  targetRepoUrl: string;
  frameworkDetected: 'pytest' | 'jest' | 'vitest' | 'mocha' | 'cargo' | 'gotest' | 'generic';
  failureCount: number;
  failingTests: string[];
  failureType: string;
  primaryFailureMessage: string;
  stackTraceFrames: FailureFrame[];
  primaryRootCauseLocation: SourceLocation;
  secondaryLocations: SourceLocation[];
  hypotheses: RootCauseHypothesis[];
  rawLogExcerpt: string;
}

export interface FilePatch {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  astValid: boolean;
  syntaxErrors: string[];
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
  scopeCreepAssessment: {
    passed: boolean;
    implicatedOnly: boolean;
    unrelatedFilesTouched: string[];
    riskScore: number; // 0 to 100
  };
  synthesisDurationMs: number;
}

export interface TestCaseResult {
  testId: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
}

export interface VerificationReport {
  sessionId: string;
  threadId: string;
  attemptNumber: number;
  overallStatus: 'PASSED' | 'FAILED' | 'FLAKY' | 'TIMEOUT' | 'EXEC_ERROR';
  exitCode: number;
  durationMs: number;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  baselineComparison: {
    previouslyFailingNowPassing: string[];
    newRegressions: string[];
    stillFailing: string[];
  };
  flakyTestDetails: {
    detected: boolean;
    flakyTests: string[];
    rerunCount: number;
  };
  stdoutExcerpt: string;
  stderrExcerpt: string;
}

export interface ToolApprovalRequiredPayload {
  toolCallId: string;
  toolName: 'github_mcp_create_pull_request' | 'git_push';
  parameters: Record<string, unknown>;
  resumeToken: string;
  proposedPatch: string;
  scorecard: QodoScorecardResult;
  timestamp: string;
}

export interface UserToolApprovalInput {
  resumeToken: string;
  status: 'allow' | 'deny';
  reviewerFeedback?: string;
}

export interface TrueForgeSession {
  sessionId: string;
  targetRepoUrl: string;
  language: SupportedLanguage;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  threads: Map<string, TrueForgeThread>;
  resumeToken?: string;
  diagnosticReport?: DiagnosticReport;
  patchResult?: PatchSynthesisResult;
  verificationReport?: VerificationReport;
  scorecard?: QodoScorecardResult;
  prResult?: GitHubPRResult;
}

export interface TrueForgeThread {
  threadId: string;
  agentRole: AgentRole;
  parentThreadId?: string;
  turns: TrueForgeTurn[];
  createdAt: string;
}

export interface TrueForgeTurn {
  turnId: string;
  input: string;
  output?: string;
  events: SSEEvent[];
  status: 'running' | 'paused' | 'completed' | 'failed';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Daytona Sandbox Contracts (F08 - F12)
// ---------------------------------------------------------------------------

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  durationMs: number;
}

export interface TestExecutionResult {
  passed: boolean;
  exitCode: number;
  rawOutput: string;
  durationMs: number;
  failedTests: Array<{
    testName: string;
    testFile?: string;
    line?: number;
    errorSnippet: string;
    stackTrace: string;
  }>;
  passedTestsCount: number;
  failedTestsCount: number;
}

export interface PatchPayload {
  filePath?: string;
  fileContent?: string;
  diff?: string;
  isUnifiedDiff?: boolean;
}

export interface PatchResult {
  applied: boolean;
  modifiedFiles: string[];
  diff: string;
  error?: string;
}

export interface GitDiffResult {
  diff: string;
  files: Array<{
    path: string;
    status: 'modified' | 'added' | 'deleted';
    insertions: number;
    deletions: number;
  }>;
  totalInsertions: number;
  totalDeletions: number;
}

export interface ISandboxInstance {
  readonly id: string;
  readonly language: SupportedLanguage;
  readonly workspaceDir: string;
  getStatus(): 'starting' | 'running' | 'stopping' | 'terminated' | 'error';
  executeCommand(command: string, options?: CommandOptions): Promise<CommandResult>;
  streamCommand(command: string, onData: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void, options?: CommandOptions): Promise<CommandResult>;
  readFile(remotePath: string): Promise<string>;
  writeFile(remotePath: string, content: string | Buffer): Promise<void>;
  uploadFile(remotePath: string, content: string | Buffer): Promise<void>;
  downloadFile(remotePath: string, localDestinationPath: string): Promise<void>;
  deleteFile(remotePath: string, recursive?: boolean): Promise<void>;
  listFiles(dirPath: string): Promise<Array<{ name: string; isDir: boolean; size: number }>>;
  cloneRepository(repoUrl: string, branch?: string): Promise<{ repoPath: string; headCommit: string }>;
  installDependencies(workDir?: string): Promise<CommandResult>;
  runBaselineTests(customCommand?: string): Promise<TestExecutionResult>;
  applyPatch(patch: PatchPayload): Promise<PatchResult>;
  runVerificationTests(customCommand?: string): Promise<TestExecutionResult>;
  getGitDiff(): Promise<GitDiffResult>;
  runQodoCover(targetFile: string): Promise<{ testFile: string; code: string }>;
  runQodoScorecard(): Promise<QodoScorecardResult>;
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Qodo CLI & Scorecard Contracts (F13, F14)
// ---------------------------------------------------------------------------

export interface QodoGeneratedTestCase {
  testName: string;
  testCode: string;
  description: string;
  targetFunction: string;
  testType: 'regression' | 'edge_case' | 'boundary' | 'error_handling';
  passed: boolean;
}

export interface QodoCoverResult {
  success: boolean;
  baselineCoverage: number;
  finalCoverage: number;
  coverageDelta: number;
  generatedTests: QodoGeneratedTestCase[];
  testOutput: string;
  modifiedTestFilePath: string;
  executionDurationMs: number;
}

export interface QodoScorecardMetric {
  name: string;
  score: number; // 0 - 100
  weight: number; // 0.0 - 1.0
  status: 'passed' | 'warning' | 'failed';
  details: string;
}

export interface QodoSecurityFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  cveOrCwe?: string;
  lineRange?: { start: number; end: number };
  mitigated: boolean;
}

export interface QodoScorecardResult {
  overallScore: number; // 0 - 100
  qualityScore: number; // 0 - 100
  securityScore: number; // 0 - 100
  coverageScore: number; // 0 - 100
  performanceScore: number; // 0 - 100
  grade?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  verdict?: 'APPROVED_FOR_PR' | 'REQUIRES_MANUAL_REVIEW' | 'REJECTED';
  metrics?: {
    codeQuality: QodoScorecardMetric;
    security: QodoScorecardMetric;
    testCoverage: QodoScorecardMetric;
    performance: QodoScorecardMetric;
  };
  breakdown: {
    ruleViolations: string[];
    securityRisks: string[];
    complexityIndex: number;
    synthesizedTests: number;
  };
  passed: boolean;
}

// ---------------------------------------------------------------------------
// GitHub MCP & PR Contracts (F15, F16)
// ---------------------------------------------------------------------------

export interface GitHubCreateBranchParams {
  owner: string;
  repo: string;
  branch: string;
  from_branch?: string;
}

export interface GitHubCreateOrUpdateFileParams {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  branch: string;
}

export interface GitHubCreatePullRequestParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface GitHubPRResult {
  prNumber: number;
  prUrl: string;
  branch: string;
  title: string;
  body: string;
  sha: string;
}

// ---------------------------------------------------------------------------
// SSE & Mission Control Wire Protocol (F07, F17 - F21)
// ---------------------------------------------------------------------------

export type SSEEvent =
  | { type: 'session.started'; payload: { sessionId: string; repoUrl: string; timestamp?: string } }
  | { type: 'session.state_changed'; payload: { sessionId: string; fromState: SessionStatus; toState: SessionStatus; reason?: string } }
  | { type: 'agent.status'; payload: { agent: AgentRole; status: 'running' | 'completed' | 'failed'; message: string } }
  | { type: 'agent.thought.delta'; payload: { delta: string; threadId?: string; turnId?: string } }
  | { type: 'agent.thought'; payload: { thought: string; threadId?: string; turnId?: string } }
  | { type: 'sandbox.log.delta'; payload: { stream: 'stdout' | 'stderr'; text: string; threadId?: string } }
  | { type: 'patch.generated'; payload: { diff: string; filesChanged: string[] } }
  | { type: 'test.result'; payload: { phase: 'baseline' | 'verification'; exitCode: number; summary: string } }
  | { type: 'qodo.scorecard'; payload: QodoScorecardResult }
  | { type: 'tool.approval_required'; payload: ToolApprovalRequiredPayload }
  | { type: 'tool.approval_resolved'; payload: { status: 'allow' | 'deny'; timestamp: string; feedback?: string } }
  | { type: 'github.pr_created'; payload: { prUrl: string; prNumber: number; branch: string } }
  | { type: 'session.completed'; payload: { sessionId: string; status: 'healed' | 'rejected' | 'failed'; durationMs: number } }
  | { type: 'session.error'; payload: { error: string; code?: string } };

export interface ScenarioDefinition {
  id: string;
  name: string;
  language: SupportedLanguage;
  description: string;
  testFramework: 'pytest' | 'jest' | 'vitest' | 'cargo' | 'gotest';
  targetRepoUrl: string;
  targetFiles: string[];
  expectedBugType: string;
  estimatedDurationMs: number;
}
