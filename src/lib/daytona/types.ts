/**
 * OpenHeal — Daytona Sandbox Execution Engine Types
 *
 * Authoritative interface and type definitions for Daytona Sandboxes (@daytona/sdk)
 * and the deterministic MockLocalSandbox fallback engine.
 */

export type SupportedLanguage = 'node' | 'python' | 'go' | 'rust';

export type SandboxStatus = 'starting' | 'running' | 'stopping' | 'terminated' | 'error';

export type SandboxMode = 'production' | 'mock' | 'auto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DaytonaEngineConfig {
  apiKey?: string;
  serverUrl?: string;
  target?: string;
  defaultTimeoutMs?: number;
  mode?: SandboxMode; // 'auto' falls back to mock if apiKey is missing
  logLevel?: LogLevel;
  workingDirBase?: string;
}

export interface CreateSandboxParams {
  language: SupportedLanguage;
  image?: string;
  envVars?: Record<string, string>;
  labels?: Record<string, string>;
  timeoutMs?: number;
  scenarioId?: string; // Optional pre-seeded scenario name
  resources?: {
    cpu?: number;
    memoryMb?: number;
    diskMb?: number;
  };
}

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

export interface FailedTestCase {
  testName: string;
  testFile?: string;
  line?: number;
  errorSnippet: string;
  stackTrace: string;
}

export interface TestExecutionResult {
  passed: boolean;
  exitCode: number;
  rawOutput: string;
  durationMs: number;
  failedTests: FailedTestCase[];
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

export interface GitDiffFileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  insertions: number;
  deletions: number;
}

export interface GitDiffResult {
  diff: string;
  files: GitDiffFileChange[];
  totalInsertions: number;
  totalDeletions: number;
}

export interface QodoScorecardResult {
  score: number; // 0 - 100
  securityScore: number;
  maintainabilityScore: number;
  coverageScore: number;
  feedback: string[];
}

export interface StreamChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

export type StreamDataCallback = (chunk: StreamChunk) => void;

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
}

/**
 * Common interface for sandbox instances (both DaytonaRemoteSandbox and MockLocalSandbox).
 */
export interface ISandboxInstance {
  readonly id: string;
  readonly language: SupportedLanguage;
  readonly workspaceDir: string;
  getStatus(): SandboxStatus;

  // Process Execution
  executeCommand(command: string, options?: CommandOptions): Promise<CommandResult>;
  streamCommand(
    command: string,
    onDataOrStdout: StreamDataCallback | ((chunk: string) => void),
    onStderrOrOptions?: ((chunk: string) => void) | CommandOptions,
    maybeOptions?: CommandOptions
  ): Promise<CommandResult>;

  // Filesystem Operations
  readFile(remotePath: string): Promise<string>;
  writeFile(remotePath: string, content: string | Buffer): Promise<void>;
  uploadFile(remotePath: string, content: string | Buffer): Promise<void>;
  downloadFile(remotePath: string, localDestinationPath: string): Promise<void>;
  deleteFile(remotePath: string, recursive?: boolean): Promise<void>;
  listFiles(dirPath: string): Promise<FileEntry[]>;

  // High-Level Domain Operations
  cloneRepository(repoUrl: string, branch?: string): Promise<{ repoPath: string; headCommit: string }>;
  installDependencies(workDir?: string): Promise<CommandResult>;
  runBaselineTests(customCommand?: string): Promise<TestExecutionResult>;
  applyPatch(patch: PatchPayload): Promise<PatchResult>;
  runVerificationTests(customCommand?: string): Promise<TestExecutionResult>;
  getGitDiff(): Promise<GitDiffResult>;

  // Qodo Automation inside Sandbox
  runQodoCover(targetFile: string): Promise<{ testFile: string; code: string }>;
  runQodoScorecard(): Promise<QodoScorecardResult>;

  // Lifecycle
  destroy(): Promise<void>;
}

/**
 * Common interface for the Sandbox Execution Engine manager.
 */
export interface ISandboxExecutionEngine {
  init(): Promise<void>;
  createSandbox(params: CreateSandboxParams): Promise<ISandboxInstance>;
  getSandbox(id: string): ISandboxInstance | undefined;
  listActiveSandboxes(): ISandboxInstance[];
  destroySandbox(id: string): Promise<void>;
  destroyAll(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

export class DaytonaError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'DAYTONA_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = 'DaytonaError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DaytonaAuthError extends DaytonaError {
  constructor(message = 'Daytona authentication failed: missing or invalid API key.', details?: Record<string, unknown>) {
    super(message, 'DAYTONA_AUTH_ERROR', details);
    this.name = 'DaytonaAuthError';
  }
}

export class DaytonaProvisioningError extends DaytonaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DAYTONA_PROVISIONING_ERROR', details);
    this.name = 'DaytonaProvisioningError';
  }
}

export class CommandTimeoutError extends DaytonaError {
  public readonly partialStdout?: string;
  public readonly partialStderr?: string;

  constructor(message: string, partialStdout?: string, partialStderr?: string) {
    super(message, 'COMMAND_TIMEOUT_ERROR', { partialStdout, partialStderr });
    this.name = 'CommandTimeoutError';
    this.partialStdout = partialStdout;
    this.partialStderr = partialStderr;
  }
}

export class PatchApplicationError extends DaytonaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PATCH_APPLICATION_ERROR', details);
    this.name = 'PatchApplicationError';
  }
}

export class FileSystemError extends DaytonaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'FILESYSTEM_ERROR', details);
    this.name = 'FileSystemError';
  }
}

export class GitCloneError extends DaytonaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'GIT_CLONE_ERROR', details);
    this.name = 'GitCloneError';
  }
}
