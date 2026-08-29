/**
 * OpenHeal — Daytona Sandbox Execution Engine
 *
 * High-level orchestration engine managing sandbox lifecycles, runtime detection,
 * baseline reproduction, patch application, verification testing, git diffs,
 * and guaranteed orphan cleanup hooks.
 */

import type {
  ISandboxExecutionEngine,
  ISandboxInstance,
  CreateSandboxParams,
  DaytonaEngineConfig,
  SupportedLanguage,
  TestExecutionResult,
  PatchPayload,
  PatchResult,
  GitDiffResult,
  QodoScorecardResult,
} from './types.ts';
import {
  CommandTimeoutError,
} from './types.ts';
import { DaytonaClient } from './client.ts';

export interface RuntimeDetectionResult {
  runtime: SupportedLanguage;
  installCmd: string;
  testCmd: string;
}

export class DaytonaSandboxEngine implements ISandboxExecutionEngine {
  private client: DaytonaClient;
  private activeSandboxes: Map<string, ISandboxInstance> = new Map();
  private signalHooksRegistered = false;
  private config: DaytonaEngineConfig;

  constructor(config: DaytonaEngineConfig = {}) {
    this.config = config;
    this.client = new DaytonaClient(config);
  }

  public async init(): Promise<void> {
    await this.client.init();
    this.registerSignalHooks();
  }

  public async createSandbox(params: CreateSandboxParams): Promise<ISandboxInstance> {
    const sandbox = await this.client.createSandbox(params);
    this.activeSandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  public getSandbox(id: string): ISandboxInstance | undefined {
    return this.activeSandboxes.get(id);
  }

  public listActiveSandboxes(): ISandboxInstance[] {
    return Array.from(this.activeSandboxes.values()).filter((sbx) => sbx.getStatus() !== 'terminated');
  }

  public async destroySandbox(id: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(id);
    if (sandbox) {
      try {
        await sandbox.destroy();
      } finally {
        this.activeSandboxes.delete(id);
      }
    }
  }

  public async destroyAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, sandbox] of this.activeSandboxes.entries()) {
      promises.push(
        sandbox
          .destroy()
          .catch(() => {})
          .finally(() => {
            this.activeSandboxes.delete(id);
          })
      );
    }
    await Promise.all(promises);
  }

  /**
   * Automatically detect language runtime and default package scripts.
   */
  public async detectRuntime(sandbox: ISandboxInstance, repoDir = 'repo'): Promise<RuntimeDetectionResult> {
    const files = await sandbox.listFiles(repoDir);
    const fileNames = new Set(files.map((f) => f.name));

    if (fileNames.has('package.json')) {
      const isPnpm = fileNames.has('pnpm-lock.yaml');
      const isYarn = fileNames.has('yarn.lock');
      const isCi = fileNames.has('package-lock.json');

      let installCmd = 'npm install';
      if (isPnpm) installCmd = 'pnpm install';
      else if (isYarn) installCmd = 'yarn install --frozen-lockfile';
      else if (isCi) installCmd = 'npm ci || npm install';

      return {
        runtime: 'node',
        installCmd,
        testCmd: 'npm test -- --colors=false',
      };
    }

    if (fileNames.has('requirements.txt') || fileNames.has('pyproject.toml') || fileNames.has('setup.py')) {
      const installCmd = fileNames.has('requirements.txt')
        ? 'pip install -r requirements.txt || true'
        : 'pip install -e . || true';
      return {
        runtime: 'python',
        installCmd,
        testCmd: 'pytest -v || python3 -m unittest discover',
      };
    }

    if (fileNames.has('go.mod')) {
      return {
        runtime: 'go',
        installCmd: 'go mod download || true',
        testCmd: 'go test -v ./...',
      };
    }

    if (fileNames.has('Cargo.toml')) {
      return {
        runtime: 'rust',
        installCmd: 'cargo build --tests || true',
        testCmd: 'cargo test -- --nocapture',
      };
    }

    // Fallback based on sandbox language
    return {
      runtime: sandbox.language,
      installCmd: 'echo "No package manifest detected."',
      testCmd: 'npm test',
    };
  }

  /**
   * Wrap any promise with strict timeout and descriptive error message.
   */
  public static async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CommandTimeoutError(`Operation "${operationName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * High-level automated self-healing execution pipeline.
   */
  public async executeSelfHealingWorkflow(options: {
    sandbox: ISandboxInstance;
    repoUrl: string;
    branch?: string;
    patch?: PatchPayload;
    customTestCommand?: string;
  }): Promise<{
    baselineResult: TestExecutionResult;
    patchResult?: PatchResult;
    verificationResult?: TestExecutionResult;
    diffResult?: GitDiffResult;
    scorecardResult?: QodoScorecardResult;
  }> {
    const { sandbox, repoUrl, branch, patch, customTestCommand } = options;

    // 1. Clone target repository
    await sandbox.cloneRepository(repoUrl, branch);

    // 2. Install dependencies
    await sandbox.installDependencies();

    // 3. Execute baseline test run
    const baselineResult = await sandbox.runBaselineTests(customTestCommand);

    if (!patch) {
      return { baselineResult };
    }

    // 4. Apply patch
    const patchResult = await sandbox.applyPatch(patch);
    if (!patchResult.applied) {
      return { baselineResult, patchResult };
    }

    // 5. Execute verification test run
    const verificationResult = await sandbox.runVerificationTests(customTestCommand);

    // 6. Extract Git diff
    const diffResult = await sandbox.getGitDiff();

    // 7. Calculate Qodo Scorecard
    const scorecardResult = await sandbox.runQodoScorecard();

    return {
      baselineResult,
      patchResult,
      verificationResult,
      diffResult,
      scorecardResult,
    };
  }

  private registerSignalHooks(): void {
    if (this.signalHooksRegistered || typeof process === 'undefined') return;

    const cleanup = async () => {
      try {
        await this.destroyAll();
      } catch {
        // ignore
      }
    };

    process.once('SIGINT', async () => {
      await cleanup();
      process.exit(130);
    });

    process.once('SIGTERM', async () => {
      await cleanup();
      process.exit(143);
    });

    process.once('beforeExit', async () => {
      await cleanup();
    });

    this.signalHooksRegistered = true;
  }
}

// Singleton helper
let defaultEngineInstance: DaytonaSandboxEngine | null = null;

export function getDaytonaEngine(config?: DaytonaEngineConfig): DaytonaSandboxEngine {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new DaytonaSandboxEngine(config);
  }
  return defaultEngineInstance;
}

export function createDaytonaEngine(config?: DaytonaEngineConfig): DaytonaSandboxEngine {
  return new DaytonaSandboxEngine(config);
}
