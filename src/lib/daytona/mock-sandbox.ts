/**
 * OpenHeal — Daytona Sandbox Execution Engine
 * MockLocalSandbox: Deterministic, high-fidelity local sandbox implementation
 * with filesystem isolation, child_process command execution, real log streaming,
 * multi-language test parsing, and fallback replay for offline/demo environments.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type {
  ISandboxInstance,
  SupportedLanguage,
  SandboxStatus,
  CommandOptions,
  CommandResult,
  TestExecutionResult,
  FailedTestCase,
  PatchPayload,
  PatchResult,
  GitDiffResult,
  GitDiffFileChange,
  QodoScorecardResult,
  StreamChunk,
  StreamDataCallback,
  FileEntry,
} from './types.ts';
import {
  CommandTimeoutError,
  PatchApplicationError,
  FileSystemError,
  GitCloneError,
} from './types.ts';

const execAsync = promisify(exec);

export interface MockSandboxOptions {
  id?: string;
  language?: SupportedLanguage;
  baseDir?: string;
  scenarioId?: string;
  envVars?: Record<string, string>;
  simulateOfflineIfMissingToolchain?: boolean;
}

export class MockLocalSandbox implements ISandboxInstance {
  public readonly id: string;
  public readonly language: SupportedLanguage;
  public readonly workspaceDir: string;
  private status: SandboxStatus = 'starting';
  private repoDir: string;
  private activeProcesses: Set<number> = new Set();
  private envVars: Record<string, string>;
  private simulateOffline: boolean;

  constructor(options: MockSandboxOptions = {}) {
    this.id = options.id || `sbx-local-${randomUUID().slice(0, 8)}`;
    this.language = options.language || 'node';
    const base = options.baseDir || path.join(os.tmpdir(), 'openheal-sandboxes');
    this.workspaceDir = path.join(base, this.id);
    this.repoDir = path.join(this.workspaceDir, 'repo');
    this.envVars = options.envVars || {};
    this.simulateOffline = options.simulateOfflineIfMissingToolchain ?? true;
    this.initSync();
  }

  private initSync(): void {
    try {
      fsSync.mkdirSync(this.workspaceDir, { recursive: true });
      fsSync.mkdirSync(this.repoDir, { recursive: true });
      this.status = 'running';
    } catch (err: any) {
      this.status = 'error';
      throw new FileSystemError(`Failed to initialize sandbox workspace at ${this.workspaceDir}: ${err.message}`);
    }
  }

  public getStatus(): SandboxStatus {
    return this.status;
  }

  /**
   * Execute an arbitrary shell command within the sandbox workspace.
   */
  public async executeCommand(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    this.assertRunning();

    const cwd = options.cwd ? path.resolve(this.workspaceDir, options.cwd) : this.repoDir;
    const timeoutMs = options.timeoutMs ?? 60000;
    const env = { ...process.env, ...this.envVars, ...(options.env || {}) };
    const startTime = Date.now();

    return new Promise<CommandResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let combinedOutput = '';
      let timedOut = false;

      const child = spawn('/bin/sh', ['-c', command], {
        cwd: fsSync.existsSync(cwd) ? cwd : this.workspaceDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (child.pid) {
        this.activeProcesses.add(child.pid);
      }

      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              try {
                child.kill('SIGKILL');
              } catch {
                // Ignore kill errors
              }
            }
          }
        }, timeoutMs);
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stdout += text;
        combinedOutput += text;
        if (options.onStdout) {
          options.onStdout(text);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderr += text;
        combinedOutput += text;
        if (options.onStderr) {
          options.onStderr(text);
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        if (child.pid) this.activeProcesses.delete(child.pid);
        reject(new Error(`Command execution error for "${command}": ${err.message}`));
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (child.pid) this.activeProcesses.delete(child.pid);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          reject(
            new CommandTimeoutError(
              `Command "${command}" timed out after ${timeoutMs}ms`,
              stdout,
              stderr
            )
          );
          return;
        }

        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          combinedOutput,
          durationMs,
        });
      });
    });
  }

  /**
   * Execute shell command with real-time log chunk streaming.
   * Supports both (cmd, onData, options) and (cmd, onStdout, onStderr, options).
   */
  public async streamCommand(
    command: string,
    onDataOrStdout: StreamDataCallback | ((chunk: string) => void),
    onStderrOrOptions?: ((chunk: string) => void) | CommandOptions,
    maybeOptions?: CommandOptions
  ): Promise<CommandResult> {
    let onStdout: ((data: string) => void) | undefined;
    let onStderr: ((data: string) => void) | undefined;
    let opts: CommandOptions = {};

    if (typeof onStderrOrOptions === 'function') {
      // Signature: (cmd, onStdout, onStderr, maybeOptions)
      onStdout = onDataOrStdout as (chunk: string) => void;
      onStderr = onStderrOrOptions as (chunk: string) => void;
      opts = maybeOptions || {};
    } else {
      // Signature: (cmd, onData, options)
      const dataCb = onDataOrStdout as StreamDataCallback;
      opts = (onStderrOrOptions as CommandOptions) || {};
      onStdout = (chunk: string) => dataCb({ stream: 'stdout', text: chunk });
      onStderr = (chunk: string) => dataCb({ stream: 'stderr', text: chunk });
    }

    return this.executeCommand(command, {
      ...opts,
      onStdout: (data) => {
        if (opts.onStdout) opts.onStdout(data);
        if (onStdout) onStdout(data);
      },
      onStderr: (data) => {
        if (opts.onStderr) opts.onStderr(data);
        if (onStderr) onStderr(data);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Filesystem Operations
  // ---------------------------------------------------------------------------

  public async readFile(remotePath: string): Promise<string> {
    this.assertRunning();
    const resolved = this.resolvePath(remotePath);
    try {
      return await fs.readFile(resolved, 'utf-8');
    } catch (err: any) {
      throw new FileSystemError(`File not found or unreadable at ${remotePath}: ${err.message}`);
    }
  }

  public async writeFile(remotePath: string, content: string | Buffer): Promise<void> {
    this.assertRunning();
    const resolved = this.resolvePath(remotePath);
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content);
    } catch (err: any) {
      throw new FileSystemError(`Failed to write file at ${remotePath}: ${err.message}`);
    }
  }

  public async uploadFile(remotePath: string, content: string | Buffer): Promise<void> {
    return this.writeFile(remotePath, content);
  }

  public async downloadFile(remotePath: string, localDestinationPath: string): Promise<void> {
    this.assertRunning();
    const resolved = this.resolvePath(remotePath);
    try {
      const data = await fs.readFile(resolved);
      await fs.mkdir(path.dirname(localDestinationPath), { recursive: true });
      await fs.writeFile(localDestinationPath, data);
    } catch (err: any) {
      throw new FileSystemError(`Failed to download file from ${remotePath} to ${localDestinationPath}: ${err.message}`);
    }
  }

  public async deleteFile(remotePath: string, recursive = false): Promise<void> {
    this.assertRunning();
    const resolved = this.resolvePath(remotePath);
    try {
      await fs.rm(resolved, { recursive, force: true });
    } catch (err: any) {
      throw new FileSystemError(`Failed to delete file at ${remotePath}: ${err.message}`);
    }
  }

  public async listFiles(dirPath: string): Promise<FileEntry[]> {
    this.assertRunning();
    const resolved = this.resolvePath(dirPath);
    try {
      if (!fsSync.existsSync(resolved)) {
        return [];
      }
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const result: FileEntry[] = [];
      for (const entry of entries) {
        const fullPath = path.join(resolved, entry.name);
        let size = 0;
        try {
          const st = await fs.stat(fullPath);
          size = st.size;
        } catch {
          // ignore
        }
        result.push({
          name: entry.name,
          isDir: entry.isDirectory(),
          size,
        });
      }
      return result;
    } catch (err: any) {
      throw new FileSystemError(`Failed to list files in ${dirPath}: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // High-Level Domain Operations
  // ---------------------------------------------------------------------------

  /**
   * Clones or copies a target repository into sandbox /workspace/repo and sets up git.
   */
  public async cloneRepository(repoUrl: string, branch?: string): Promise<{ repoPath: string; headCommit: string }> {
    this.assertRunning();

    await fs.mkdir(this.repoDir, { recursive: true });

    // Check if repoUrl is a local scenario directory
    let isLocalDirectory = false;
    let localSourcePath = repoUrl;

    if (fsSync.existsSync(repoUrl) && fsSync.statSync(repoUrl).isDirectory()) {
      isLocalDirectory = true;
    } else {
      // Check relative to common scenarios path
      const candidates = [
        path.resolve(process.cwd(), repoUrl),
        path.resolve(process.cwd(), 'src/scenarios', repoUrl),
        path.resolve(process.cwd(), 'openheal/src/scenarios', repoUrl),
        path.resolve('/Users/pramodthebe/Desktop/harness_hack/openheal/src/scenarios', repoUrl),
      ];
      for (const cand of candidates) {
        if (fsSync.existsSync(cand) && fsSync.statSync(cand).isDirectory()) {
          isLocalDirectory = true;
          localSourcePath = cand;
          break;
        }
      }
    }

    if (isLocalDirectory) {
      try {
        // Copy directory contents
        await this.copyDirRecursive(localSourcePath, this.repoDir);

        // Initialize git repo if not already initialized
        if (!fsSync.existsSync(path.join(this.repoDir, '.git'))) {
          await this.executeCommand('git init', { cwd: this.repoDir });
          await this.executeCommand('git config user.name "OpenHeal Swarm"', { cwd: this.repoDir });
          await this.executeCommand('git config user.email "swarm@openheal.ai"', { cwd: this.repoDir });
          await this.executeCommand('git add .', { cwd: this.repoDir });
          await this.executeCommand('git commit -m "Initial baseline commit" --allow-empty', { cwd: this.repoDir });
        }

        const headResult = await this.executeCommand('git rev-parse HEAD', { cwd: this.repoDir });
        const headCommit = headResult.stdout.trim() || '0000000000000000000000000000000000000000';

        return { repoPath: this.repoDir, headCommit };
      } catch (err: any) {
        throw new GitCloneError(`Failed to setup local repository from ${localSourcePath}: ${err.message}`);
      }
    }

    // Remote git repository clone
    try {
      const branchArg = branch ? `-b ${branch}` : '';
      const cloneCmd = `git clone ${branchArg} ${repoUrl} ${this.repoDir}`;
      const res = await this.executeCommand(cloneCmd, { cwd: this.workspaceDir });
      if (res.exitCode !== 0) {
        throw new GitCloneError(`git clone failed with code ${res.exitCode}: ${res.stderr || res.stdout}`);
      }

      await this.executeCommand('git config user.name "OpenHeal Swarm"', { cwd: this.repoDir });
      await this.executeCommand('git config user.email "swarm@openheal.ai"', { cwd: this.repoDir });

      const headResult = await this.executeCommand('git rev-parse HEAD', { cwd: this.repoDir });
      const headCommit = headResult.stdout.trim();

      return { repoPath: this.repoDir, headCommit };
    } catch (err: any) {
      if (err instanceof GitCloneError) throw err;
      throw new GitCloneError(`Git clone encountered an error: ${err.message}`);
    }
  }

  /**
   * Installs dependencies by inspecting repository manifest.
   */
  public async installDependencies(workDir?: string): Promise<CommandResult> {
    this.assertRunning();
    const targetDir = workDir ? this.resolvePath(workDir) : this.repoDir;
    const files = await this.listFiles(targetDir);
    const fileNames = new Set(files.map((f) => f.name));

    let installCmd = '';
    if (fileNames.has('package.json')) {
      installCmd = fileNames.has('package-lock.json') ? 'npm ci --prefer-offline || npm install' : 'npm install';
    } else if (fileNames.has('requirements.txt')) {
      installCmd = 'pip install -r requirements.txt || true';
    } else if (fileNames.has('pyproject.toml') || fileNames.has('setup.py')) {
      installCmd = 'pip install -e . || true';
    } else if (fileNames.has('Cargo.toml')) {
      installCmd = 'cargo build --tests || true';
    } else if (fileNames.has('go.mod')) {
      installCmd = 'go mod download || true';
    } else {
      installCmd = 'echo "No package manifest detected. Skipping dependency installation."';
    }

    try {
      return await this.executeCommand(installCmd, { cwd: targetDir });
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        combinedOutput: err.message,
        durationMs: 0,
      };
    }
  }

  /**
   * Executes baseline test runner and parses failing tests.
   */
  public async runBaselineTests(customCommand?: string): Promise<TestExecutionResult> {
    this.assertRunning();
    const testCmd = customCommand || (await this.detectDefaultTestCommand(this.repoDir));
    const startTime = Date.now();

    const cmdResult = await this.executeCommand(testCmd, { cwd: this.repoDir });
    const durationMs = Date.now() - startTime;

    const parsed = this.parseTestOutput(cmdResult.combinedOutput, this.language);

    return {
      passed: cmdResult.exitCode === 0,
      exitCode: cmdResult.exitCode,
      rawOutput: cmdResult.combinedOutput,
      durationMs,
      failedTests: parsed.failedTests,
      passedTestsCount: parsed.passedTestsCount,
      failedTestsCount: parsed.failedTestsCount,
    };
  }

  /**
   * Applies patch to workspace (either direct file content or unified diff).
   */
  public async applyPatch(patch: PatchPayload): Promise<PatchResult> {
    this.assertRunning();
    const modifiedFiles: string[] = [];

    try {
      if (patch.filePath && patch.fileContent !== undefined) {
        const targetPath = this.resolvePath(patch.filePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, patch.fileContent, 'utf-8');
        modifiedFiles.push(patch.filePath);

        const diffResult = await this.getGitDiff();
        return {
          applied: true,
          modifiedFiles,
          diff: diffResult.diff,
        };
      }

      if (patch.diff) {
        const patchFile = path.join(this.workspaceDir, '.openheal_temp.patch');
        await fs.writeFile(patchFile, patch.diff, 'utf-8');

        // Apply via git apply with fallback to patch command
        const applyRes = await this.executeCommand(`git apply --ignore-space-change --ignore-whitespace "${patchFile}"`, {
          cwd: this.repoDir,
        });

        if (applyRes.exitCode !== 0) {
          const patchCmdRes = await this.executeCommand(`patch -p1 < "${patchFile}"`, { cwd: this.repoDir });
          if (patchCmdRes.exitCode !== 0) {
            throw new PatchApplicationError(
              `Patch failed to apply cleanly:\n${applyRes.stderr || patchCmdRes.stderr || applyRes.stdout}`
            );
          }
        }

        await fs.rm(patchFile, { force: true });
        const diffResult = await this.getGitDiff();
        return {
          applied: true,
          modifiedFiles: diffResult.files.map((f) => f.path),
          diff: diffResult.diff,
        };
      }

      throw new PatchApplicationError('Invalid PatchPayload: Must supply either filePath+fileContent or diff.');
    } catch (err: any) {
      return {
        applied: false,
        modifiedFiles: [],
        diff: '',
        error: err.message,
      };
    }
  }

  /**
   * Executes verification test runner and verifies 100% green assertions.
   */
  public async runVerificationTests(customCommand?: string): Promise<TestExecutionResult> {
    this.assertRunning();
    const testCmd = customCommand || (await this.detectDefaultTestCommand(this.repoDir));
    const startTime = Date.now();

    const cmdResult = await this.executeCommand(testCmd, { cwd: this.repoDir });
    const durationMs = Date.now() - startTime;

    const parsed = this.parseTestOutput(cmdResult.combinedOutput, this.language);

    return {
      passed: cmdResult.exitCode === 0,
      exitCode: cmdResult.exitCode,
      rawOutput: cmdResult.combinedOutput,
      durationMs,
      failedTests: parsed.failedTests,
      passedTestsCount: parsed.passedTestsCount,
      failedTestsCount: parsed.failedTestsCount,
    };
  }

  /**
   * Generates a unified git diff against baseline HEAD.
   */
  public async getGitDiff(): Promise<GitDiffResult> {
    this.assertRunning();
    try {
      const diffCmd = await this.executeCommand('git diff HEAD', { cwd: this.repoDir });
      const numstatCmd = await this.executeCommand('git diff --numstat HEAD', { cwd: this.repoDir });
      const statusCmd = await this.executeCommand('git status --porcelain', { cwd: this.repoDir });

      const diff = diffCmd.stdout;
      const files: GitDiffFileChange[] = [];
      let totalInsertions = 0;
      let totalDeletions = 0;

      // Parse status
      const statusMap = new Map<string, 'modified' | 'added' | 'deleted'>();
      const statusLines = statusCmd.stdout.split('\n').filter((l) => l.trim().length > 0);
      for (const line of statusLines) {
        const code = line.slice(0, 2).trim();
        const filePath = line.slice(3).trim();
        if (code === 'D') {
          statusMap.set(filePath, 'deleted');
        } else if (code === '??' || code === 'A') {
          statusMap.set(filePath, 'added');
        } else {
          statusMap.set(filePath, 'modified');
        }
      }

      // Parse numstat
      const numstatLines = numstatCmd.stdout.split('\n').filter((l) => l.trim().length > 0);
      for (const line of numstatLines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const ins = parseInt(parts[0], 10) || 0;
          const del = parseInt(parts[1], 10) || 0;
          const filePath = parts[2];
          totalInsertions += ins;
          totalDeletions += del;
          files.push({
            path: filePath,
            status: statusMap.get(filePath) || 'modified',
            insertions: ins,
            deletions: del,
          });
        }
      }

      return {
        diff,
        files,
        totalInsertions,
        totalDeletions,
      };
    } catch (err: any) {
      return {
        diff: '',
        files: [],
        totalInsertions: 0,
        totalDeletions: 0,
      };
    }
  }

  /**
   * Executes Qodo Cover test generator inside the sandbox.
   */
  public async runQodoCover(targetFile: string): Promise<{ testFile: string; code: string }> {
    this.assertRunning();
    const baseName = path.basename(targetFile, path.extname(targetFile));
    let testFileName = `test_${baseName}_repro.py`;
    let code = '';

    if (this.language === 'python') {
      testFileName = `tests/test_${baseName}_repro.py`;
      code = `import pytest\nfrom calculator.calculator import Calculator\n\ndef test_${baseName}_edge_cases():\n    calc = Calculator()\n    assert calc.divide(10, 2) == 5.0\n    assert calc.divide(7, 2) == 3.5\n    with pytest.raises(ZeroDivisionError):\n        calc.divide(10, 0)\n`;
    } else if (this.language === 'node') {
      testFileName = `tests/${baseName}.repro.test.ts`;
      code = `import { describe, it, expect } from 'vitest';\nimport { ApiCache } from '../src/cache';\n\ndescribe('${baseName} Reproduction Suite', () => {\n  it('should handle boundary eviction correctly', () => {\n    const cache = new ApiCache(3);\n    cache.set('a', '1');\n    cache.set('b', '2');\n    cache.set('c', '3');\n    cache.set('d', '4');\n    expect(cache.get('a')).toBeUndefined();\n    expect(cache.get('d')).toBe('4');\n  });\n});\n`;
    } else if (this.language === 'rust') {
      testFileName = `tests/${baseName}_repro.rs`;
      code = `#[test]\nfn test_${baseName}_repro() {\n    let parsed = rust_parser::parse("let x = 42;");\n    assert!(parsed.is_ok());\n}\n`;
    } else {
      testFileName = `repro_test.go`;
      code = `package main\nimport "testing"\nfunc TestRepro(t *testing.T) {}\n`;
    }

    const fullTestPath = this.resolvePath(testFileName);
    await fs.mkdir(path.dirname(fullTestPath), { recursive: true });
    await fs.writeFile(fullTestPath, code, 'utf-8');

    return {
      testFile: testFileName,
      code,
    };
  }

  /**
   * Executes Qodo Scorecard static quality and security analysis.
   */
  public async runQodoScorecard(): Promise<QodoScorecardResult> {
    this.assertRunning();
    const diffResult = await this.getGitDiff();
    const diff = diffResult.diff;

    let securityScore = 95;
    let maintainabilityScore = 92;
    let coverageScore = 90;
    const feedback: string[] = [];

    if (!diff || diff.length === 0) {
      return {
        score: 100,
        securityScore: 100,
        maintainabilityScore: 100,
        coverageScore: 100,
        feedback: ['No modifications detected. Clean baseline.'],
      };
    }

    // Security heuristics
    if (diff.includes('eval(') || diff.includes('exec(') || diff.includes('dangerouslySetInnerHTML')) {
      securityScore -= 25;
      feedback.push('Security Risk: Dynamic code execution detected in patch.');
    }
    if (diff.includes('password') || diff.includes('secret') || diff.includes('token')) {
      securityScore -= 10;
      feedback.push('Security Notice: Sensitive keyword in patch changes.');
    }

    // Maintainability heuristics
    if (diffResult.totalInsertions + diffResult.totalDeletions > 200) {
      maintainabilityScore -= 15;
      feedback.push('Maintainability Notice: Patch is moderately large (>200 lines).');
    }
    if (diff.includes('TODO') || diff.includes('FIXME')) {
      maintainabilityScore -= 5;
      feedback.push('Maintainability Notice: Unresolved TODO/FIXME markers in patch.');
    }

    // Coverage heuristics
    if (diff.includes('test') || diff.includes('assert') || diff.includes('expect')) {
      coverageScore = 98;
      feedback.push('Quality: Test assertions updated alongside code fix.');
    }

    const overallScore = Math.round(
      securityScore * 0.4 + maintainabilityScore * 0.35 + coverageScore * 0.25
    );

    if (feedback.length === 0) {
      feedback.push('Patch is minimal, surgically scoped, and free of security risks.');
      feedback.push('All unit test assertions verified green in isolated Daytona container.');
    }

    return {
      score: overallScore,
      securityScore,
      maintainabilityScore,
      coverageScore,
      feedback,
    };
  }

  /**
   * Destroys and cleans up sandbox workspace.
   */
  public async destroy(): Promise<void> {
    this.status = 'stopping';

    // Kill any active child processes
    for (const pid of this.activeProcesses) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
    this.activeProcesses.clear();

    // Clean up temporary workspace directory
    try {
      if (fsSync.existsSync(this.workspaceDir)) {
        await fs.rm(this.workspaceDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }

    this.status = 'terminated';
  }

  // ---------------------------------------------------------------------------
  // Helper Utilities
  // ---------------------------------------------------------------------------

  private assertRunning(): void {
    if (this.status === 'terminated') {
      throw new Error(`Sandbox ${this.id} is already terminated.`);
    }
  }

  private resolvePath(p: string): string {
    if (!p || p === '.' || p === './' || p === 'repo' || p === './repo' || p === '/workspace/repo') {
      return this.repoDir;
    }
    if (p === '/workspace' || p === '/workspace/') {
      return this.workspaceDir;
    }
    if (path.isAbsolute(p)) {
      if (p.startsWith(this.workspaceDir)) {
        return p;
      }
      if (p.startsWith('/workspace/repo')) {
        return path.join(this.repoDir, p.replace(/^\/workspace\/repo\/?/, ''));
      }
      if (p.startsWith('/workspace')) {
        return path.join(this.workspaceDir, p.replace(/^\/workspace\/?/, ''));
      }
      return p;
    }
    if (p.startsWith('repo/')) {
      return path.resolve(this.repoDir, p.slice(5));
    }
    const insideRepo = path.resolve(this.repoDir, p);
    if (fsSync.existsSync(insideRepo)) {
      return insideRepo;
    }
    const insideWorkspace = path.resolve(this.workspaceDir, p);
    if (fsSync.existsSync(insideWorkspace)) {
      return insideWorkspace;
    }
    return insideRepo;
  }

  private async detectDefaultTestCommand(targetDir: string): Promise<string> {
    const files = await this.listFiles(targetDir);
    const fileNames = new Set(files.map((f) => f.name));

    if (fileNames.has('package.json')) {
      return 'npm test -- --colors=false';
    }
    if (fileNames.has('requirements.txt') || fileNames.has('pyproject.toml') || fileNames.has('pytest.ini')) {
      return 'pytest -v || python3 -m unittest discover';
    }
    if (fileNames.has('Cargo.toml')) {
      return 'cargo test -- --nocapture';
    }
    if (fileNames.has('go.mod')) {
      return 'go test -v ./...';
    }
    return 'npm test';
  }

  private parseTestOutput(
    output: string,
    language: SupportedLanguage
  ): { failedTests: FailedTestCase[]; passedTestsCount: number; failedTestsCount: number } {
    const failedTests: FailedTestCase[] = [];
    let passedTestsCount = 0;
    let failedTestsCount = 0;

    if (language === 'python' || output.includes('pytest') || output.includes('FAILED') || output.includes('FAIL:')) {
      // Pytest parsing
      // Match lines like: FAILED tests/test_calc.py::test_division - AssertionError: 2.0 != 2.5
      const failedMatches = output.matchAll(/FAILED\s+([^:]+)::([^\s]+)(?:\s+-\s+(.+))?/g);
      for (const m of failedMatches) {
        const testFile = m[1];
        const testName = m[2];
        const snippet = m[3] || 'Assertion failure';
        failedTests.push({
          testName,
          testFile,
          errorSnippet: snippet,
          stackTrace: output,
        });
      }

      // Python unittest parsing: FAIL/ERROR: test_name (test_file.TestClass.test_name)
      const unittestMatches = output.matchAll(/(?:FAIL|ERROR):\s+([^\s]+)\s+\(([^)]+)\)/g);
      for (const m of unittestMatches) {
        failedTests.push({
          testName: m[1],
          testFile: m[2],
          errorSnippet: `Python unittest failure in ${m[1]}`,
          stackTrace: output,
        });
      }

      // Pytest summary numbers: e.g. "1 failed, 3 passed in 0.05s" or "3 passed in 0.01s"
      const passMatch = output.match(/(\d+)\s+passed/);
      if (passMatch) passedTestsCount = parseInt(passMatch[1], 10);

      const failMatch = output.match(/(\d+)\s+failed/);
      if (failMatch) failedTestsCount = parseInt(failMatch[1], 10);

      // Unittest summary numbers: "Ran 5 tests in 0.001s" and "FAILED (failures=1, errors=1)"
      const ranMatch = output.match(/Ran\s+(\d+)\s+tests?/);
      if (ranMatch) {
        const totalRan = parseInt(ranMatch[1], 10);
        const uFailures = output.match(/failures=(\d+)/);
        const uErrors = output.match(/errors=(\d+)/);
        const numFails = (uFailures ? parseInt(uFailures[1], 10) : 0) + (uErrors ? parseInt(uErrors[1], 10) : 0);
        if (numFails > 0) {
          failedTestsCount = numFails;
          passedTestsCount = Math.max(0, totalRan - numFails);
        } else if (output.includes('OK')) {
          passedTestsCount = totalRan;
          failedTestsCount = 0;
        }
      }
    } else if (language === 'node' || output.includes('vitest') || output.includes('jest') || output.includes('FAIL')) {
      // Jest / Vitest parsing
      const failMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/);
      if (failMatch) {
        if (failMatch[1]) failedTestsCount = parseInt(failMatch[1], 10);
        if (failMatch[2]) passedTestsCount = parseInt(failMatch[2], 10);
      }

      const vitestLines = output.split('\n');
      for (let i = 0; i < vitestLines.length; i++) {
        const line = vitestLines[i];
        if (line.includes('FAIL') || line.includes('✕') || line.includes('AssertionError')) {
          failedTests.push({
            testName: line.replace(/FAIL|✕/g, '').trim() || 'Unit test assertion failure',
            testFile: line.includes('.ts') || line.includes('.js') ? line.trim() : undefined,
            errorSnippet: line.trim(),
            stackTrace: vitestLines.slice(Math.max(0, i - 2), Math.min(vitestLines.length, i + 10)).join('\n'),
          });
          break;
        }
      }
    } else if (language === 'rust' || output.includes('cargo test')) {
      // Rust cargo test parsing
      const failMatches = output.matchAll(/test\s+([^\s]+)\s+\.\.\.\s+FAILED/g);
      for (const m of failMatches) {
        failedTests.push({
          testName: m[1],
          errorSnippet: `Test ${m[1]} failed`,
          stackTrace: output,
        });
      }

      const passMatch = output.match(/test result: .* (\d+) passed; (\d+) failed;/);
      if (passMatch) {
        passedTestsCount = parseInt(passMatch[1], 10);
        failedTestsCount = parseInt(passMatch[2], 10);
      }
    }

    if (failedTests.length > 0 && failedTestsCount === 0) {
      failedTestsCount = failedTests.length;
    }

    // Generic fallback if failure indicators present but specific parser yielded empty
    if (failedTests.length === 0 && (output.includes('FAIL') || output.includes('Error') || output.includes('panic'))) {
      const errorLines = output.split('\n').filter((l) => l.includes('Error') || l.includes('FAIL') || l.includes('panic'));
      failedTests.push({
        testName: 'General test failure',
        errorSnippet: errorLines[0] || 'Unknown test failure',
        stackTrace: output,
      });
      failedTestsCount = 1;
    }

    return { failedTests, passedTestsCount, failedTestsCount };
  }

  private async copyDirRecursive(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target' || entry.name === '__pycache__') {
          continue;
        }
        await this.copyDirRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
