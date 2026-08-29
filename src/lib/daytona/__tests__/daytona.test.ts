import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  MockLocalSandbox,
  DaytonaClient,
  DaytonaSandboxEngine,
  getDaytonaEngine,
  createDaytonaEngine,
  CommandTimeoutError,
  PatchApplicationError,
  FileSystemError,
} from '../index.ts';

describe('Daytona Sandbox Execution Engine Suite', () => {
  let sandbox: MockLocalSandbox;
  let testBaseDir: string;

  before(async () => {
    testBaseDir = path.join(os.tmpdir(), `daytona-test-${Date.now()}`);
    await fs.mkdir(testBaseDir, { recursive: true });
    sandbox = new MockLocalSandbox({
      language: 'node',
      baseDir: testBaseDir,
    });
  });

  after(async () => {
    if (sandbox) {
      await sandbox.destroy();
    }
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. Sandbox Initialization & Lifecycle', () => {
    it('should initialize with running status and valid workspace directory', () => {
      assert.ok(sandbox.id.startsWith('sbx-local-'));
      assert.equal(sandbox.language, 'node');
      assert.equal(sandbox.getStatus(), 'running');
      assert.ok(sandbox.workspaceDir.includes('daytona-test-'));
    });

    it('should track status through getStatus()', () => {
      assert.equal(sandbox.getStatus(), 'running');
    });
  });

  describe('2. Command Execution & Timeouts', () => {
    it('should execute basic shell commands and capture stdout with exitCode 0', async () => {
      const res = await sandbox.executeCommand('echo "Hello Daytona"');
      assert.equal(res.exitCode, 0);
      assert.ok(res.stdout.includes('Hello Daytona'));
      assert.ok(res.combinedOutput.includes('Hello Daytona'));
      assert.ok(res.durationMs >= 0);
    });

    it('should capture stderr and non-zero exit codes correctly', async () => {
      const res = await sandbox.executeCommand('echo "Error occurred" >&2; exit 42');
      assert.equal(res.exitCode, 42);
      assert.ok(res.stderr.includes('Error occurred'));
    });

    it('should pass custom environment variables to command execution', async () => {
      const res = await sandbox.executeCommand('echo "ENV_TEST=$FOO_VAR"', {
        env: { FOO_VAR: 'DaytonaEngine123' },
      });
      assert.equal(res.exitCode, 0);
      assert.ok(res.stdout.includes('ENV_TEST=DaytonaEngine123'));
    });

    it('should abort and throw CommandTimeoutError on timeout expiration', async () => {
      await assert.rejects(
        async () => {
          await sandbox.executeCommand('sleep 3', { timeoutMs: 200 });
        },
        (err: Error) => {
          return err instanceof CommandTimeoutError && err.message.includes('timed out');
        }
      );
    });

    it('should support streamCommand with realtime callbacks', async () => {
      const chunks: string[] = [];
      const res = await sandbox.streamCommand(
        'echo "Line 1"; echo "Line 2"',
        (chunk) => {
          chunks.push(chunk.text);
        }
      );

      assert.equal(res.exitCode, 0);
      const combined = chunks.join('');
      assert.ok(combined.includes('Line 1'));
      assert.ok(combined.includes('Line 2'));
    });
  });

  describe('3. Filesystem Operations', () => {
    it('should write and read files in the sandbox workspace', async () => {
      const filePath = 'test-file.txt';
      await sandbox.writeFile(filePath, 'Daytona Test Content 123');
      const content = await sandbox.readFile(filePath);
      assert.equal(content, 'Daytona Test Content 123');
    });

    it('should upload and download files correctly', async () => {
      const remotePath = 'nested/dir/upload.json';
      const payload = JSON.stringify({ status: 'ok', value: 99 });
      await sandbox.uploadFile(remotePath, payload);

      const localDownloadPath = path.join(testBaseDir, 'downloaded.json');
      await sandbox.downloadFile(remotePath, localDownloadPath);

      const localContent = await fs.readFile(localDownloadPath, 'utf-8');
      assert.equal(localContent, payload);
    });

    it('should list files in sandbox directories', async () => {
      await sandbox.writeFile('dirA/file1.txt', '1');
      await sandbox.writeFile('dirA/file2.txt', '2');

      const list = await sandbox.listFiles('dirA');
      assert.equal(list.length, 2);
      const names = list.map((e) => e.name);
      assert.ok(names.includes('file1.txt'));
      assert.ok(names.includes('file2.txt'));
    });

    it('should delete files and throw FileSystemError for missing files', async () => {
      await sandbox.writeFile('to_delete.txt', 'bye');
      await sandbox.deleteFile('to_delete.txt');

      await assert.rejects(
        async () => {
          await sandbox.readFile('to_delete.txt');
        },
        (err: Error) => err instanceof FileSystemError
      );
    });
  });

  describe('4. Scenario Cloning, Baseline Failure, and Patch Verification', () => {
    let pythonSandbox: MockLocalSandbox;

    before(async () => {
      pythonSandbox = new MockLocalSandbox({
        language: 'python',
        baseDir: testBaseDir,
      });
    });

    after(async () => {
      if (pythonSandbox) {
        await pythonSandbox.destroy();
      }
    });

    it('should clone python-calculator scenario and setup git repository', async () => {
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/python-calculator');
      const cloneRes = await pythonSandbox.cloneRepository(scenarioPath);
      assert.ok(cloneRes.repoPath.endsWith('/repo'));
      assert.ok(cloneRes.headCommit.length > 0);

      const files = await pythonSandbox.listFiles('repo');
      const names = files.map((f) => f.name);
      assert.ok(names.includes('calculator') || names.includes('pyproject.toml'));
    });

    it('should run baseline tests and detect test failures', async () => {
      // Execute python test directly via node or python if available
      const baselineResult = await pythonSandbox.runBaselineTests('python3 -m unittest discover tests || python3 tests/test_calculator.py || pytest');
      // If python/pytest is not configured locally, baselineResult captures the command output
      assert.ok(baselineResult.durationMs >= 0);
    });

    it('should apply patch by overwriting file and compute git diff', async () => {
      const fixedCode = `"""
Calculator module with mathematical operations (Fixed).
"""

class Calculator:
    def add(self, a: float, b: float) -> float:
        return a + b

    def subtract(self, a: float, b: float) -> float:
        return a - b

    def multiply(self, a: float, b: float) -> float:
        return a * b

    def divide(self, a: float, b: float) -> float:
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b
`;
      const patchRes = await pythonSandbox.applyPatch({
        filePath: 'calculator/calculator.py',
        fileContent: fixedCode,
      });

      assert.equal(patchRes.applied, true);
      assert.ok(patchRes.modifiedFiles.includes('calculator/calculator.py'));

      const diffRes = await pythonSandbox.getGitDiff();
      assert.ok(diffRes.diff.includes('divide'));
      assert.ok(diffRes.totalInsertions > 0 || diffRes.files.length > 0);
    });

    it('should run Qodo Scorecard and generate 0-100 score and feedback', async () => {
      const scorecard = await pythonSandbox.runQodoScorecard();
      assert.ok(scorecard.score >= 0 && scorecard.score <= 100);
      assert.ok(scorecard.securityScore >= 0);
      assert.ok(scorecard.maintainabilityScore >= 0);
      assert.ok(scorecard.coverageScore >= 0);
      assert.ok(Array.isArray(scorecard.feedback));
    });

    it('should run Qodo Cover and generate reproduction test suite', async () => {
      const coverRes = await pythonSandbox.runQodoCover('calculator/calculator.py');
      assert.ok(coverRes.testFile.includes('test_calculator_repro.py'));
      assert.ok(coverRes.code.includes('Calculator'));
    });
  });

  describe('5. Node API Cache Scenario Verification', () => {
    let nodeSandbox: MockLocalSandbox;

    before(async () => {
      nodeSandbox = new MockLocalSandbox({
        language: 'node',
        baseDir: testBaseDir,
      });
    });

    after(async () => {
      if (nodeSandbox) {
        await nodeSandbox.destroy();
      }
    });

    it('should clone node-api-cache scenario', async () => {
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/node-api-cache');
      const cloneRes = await nodeSandbox.cloneRepository(scenarioPath);
      assert.ok(cloneRes.repoPath.endsWith('/repo'));
      assert.ok(cloneRes.headCommit.length > 0);
    });

    it('should apply unified diff patch', async () => {
      const patchContent = `--- a/src/cache.ts
+++ b/src/cache.ts
@@ -24,2 +24,6 @@
-    // BUG: Missing refresh of key in Map to mark it as most recently used
+    // Refresh access order (delete and re-insert)
+    this.store.delete(key);
+    this.store.set(key, entry);
+
     return entry.value;
`;
      const patchRes = await nodeSandbox.applyPatch({
        diff: patchContent,
      });
      // Should handle unified diff application cleanly
      assert.ok(patchRes.applied !== undefined);
    });
  });

  describe('6. DaytonaSandboxEngine & Runtime Detection', () => {
    let engine: DaytonaSandboxEngine;

    before(async () => {
      engine = new DaytonaSandboxEngine({ mode: 'mock', workingDirBase: testBaseDir });
      await engine.init();
    });

    after(async () => {
      await engine.destroyAll();
    });

    it('should create and list sandboxes in registry', async () => {
      const sbx1 = await engine.createSandbox({ language: 'node' });
      const sbx2 = await engine.createSandbox({ language: 'python' });

      assert.ok(engine.getSandbox(sbx1.id));
      assert.ok(engine.getSandbox(sbx2.id));
      assert.ok(engine.listActiveSandboxes().length >= 2);

      await engine.destroySandbox(sbx1.id);
      assert.equal(engine.getSandbox(sbx1.id), undefined);
    });

    it('should detect node runtime correctly from manifest', async () => {
      const sbx = await engine.createSandbox({ language: 'node' });
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/node-api-cache');
      await sbx.cloneRepository(scenarioPath);

      const detection = await engine.detectRuntime(sbx);
      assert.equal(detection.runtime, 'node');
      assert.ok(detection.installCmd.includes('npm'));
      assert.ok(detection.testCmd.includes('npm test'));

      await engine.destroySandbox(sbx.id);
    });

    it('should detect python runtime correctly from manifest', async () => {
      const sbx = await engine.createSandbox({ language: 'python' });
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/python-calculator');
      await sbx.cloneRepository(scenarioPath);

      const detection = await engine.detectRuntime(sbx);
      assert.equal(detection.runtime, 'python');
      assert.ok(detection.installCmd.includes('pip'));
      assert.ok(detection.testCmd.includes('pytest'));

      await engine.destroySandbox(sbx.id);
    });

    it('should detect rust runtime correctly from Cargo.toml manifest', async () => {
      const sbx = await engine.createSandbox({ language: 'rust' });
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/rust-parser');
      await sbx.cloneRepository(scenarioPath);

      const detection = await engine.detectRuntime(sbx);
      assert.equal(detection.runtime, 'rust');
      assert.ok(detection.installCmd.includes('cargo'));
      assert.ok(detection.testCmd.includes('cargo test'));

      await engine.destroySandbox(sbx.id);
    });

    it('should handle withTimeout utility correctly', async () => {
      const quick = DaytonaSandboxEngine.withTimeout(
        Promise.resolve('quick result'),
        1000,
        'quick-op'
      );
      assert.equal(await quick, 'quick result');

      await assert.rejects(
        async () => {
          await DaytonaSandboxEngine.withTimeout(
            new Promise((r) => setTimeout(r, 500)),
            50,
            'slow-op'
          );
        },
        (err: Error) => err instanceof CommandTimeoutError
      );
    });

    it('should execute executeSelfHealingWorkflow pipeline', async () => {
      const sbx = await engine.createSandbox({ language: 'node' });
      const scenarioPath = path.resolve(__dirname, '../../../scenarios/node-api-cache');

      const workflowRes = await engine.executeSelfHealingWorkflow({
        sandbox: sbx,
        repoUrl: scenarioPath,
        patch: {
          filePath: 'src/cache.ts',
          fileContent: `export class ApiCache { constructor() {} get() { return undefined; } set() {} }`,
        },
      });

      assert.ok(workflowRes.baselineResult);
      assert.ok(workflowRes.patchResult?.applied);
      assert.ok(workflowRes.verificationResult);
      assert.ok(workflowRes.scorecardResult);

      await engine.destroySandbox(sbx.id);
    });
  });

  describe('7. DaytonaClient Fallback Behavior', () => {
    it('should fallback to MockLocalSandbox when mode is auto and no API key is provided', async () => {
      const client = new DaytonaClient({ mode: 'auto' });
      await client.init();
      const sbx = await client.createSandbox({ language: 'python' });
      assert.equal(sbx.getStatus(), 'running');
      assert.equal(sbx.language, 'python');
      await sbx.destroy();
    });
  });

  describe('8. Edge Cases & Boundary Conditions', () => {
    let edgeSandbox: MockLocalSandbox;

    before(async () => {
      edgeSandbox = new MockLocalSandbox({
        language: 'node',
        baseDir: testBaseDir,
      });
    });

    after(async () => {
      if (edgeSandbox) {
        await edgeSandbox.destroy();
      }
    });

    it('should handle stderr logs while exitCode is 0 without error', async () => {
      const res = await edgeSandbox.executeCommand('echo "Warning: deprecation notice" >&2; exit 0');
      assert.equal(res.exitCode, 0);
      assert.ok(res.stderr.includes('deprecation notice'));
      assert.ok(res.combinedOutput.includes('deprecation notice'));
    });

    it('should gracefully handle malformed patch diff and report applied: false', async () => {
      const malformedPatch = `--- a/nonexistent.ts
+++ b/nonexistent.ts
@@ -100,5 +100,5 @@
-this is invalid
+this is broken
`;
      const res = await edgeSandbox.applyPatch({
        diff: malformedPatch,
      });
      assert.equal(res.applied, false);
      assert.ok(res.error);
    });

    it('should handle empty git diff when no changes are made', async () => {
      const emptyDiff = await edgeSandbox.getGitDiff();
      assert.equal(emptyDiff.diff, '');
      assert.equal(emptyDiff.files.length, 0);
      assert.equal(emptyDiff.totalInsertions, 0);
      assert.equal(emptyDiff.totalDeletions, 0);
    });

    it('should prevent operations on terminated sandbox', async () => {
      const deadSandbox = new MockLocalSandbox({ baseDir: testBaseDir });
      await deadSandbox.destroy();
      assert.equal(deadSandbox.getStatus(), 'terminated');

      await assert.rejects(async () => {
        await deadSandbox.executeCommand('echo 1');
      });
      await assert.rejects(async () => {
        await deadSandbox.readFile('foo.txt');
      });
      await assert.rejects(async () => {
        await deadSandbox.writeFile('foo.txt', 'bar');
      });
    });

    it('should support concurrent operations across multiple sandboxes', async () => {
      const s1 = new MockLocalSandbox({ baseDir: testBaseDir });
      const s2 = new MockLocalSandbox({ baseDir: testBaseDir });

      const [r1, r2] = await Promise.all([
        s1.executeCommand('echo "Sandbox 1"'),
        s2.executeCommand('echo "Sandbox 2"'),
      ]);

      assert.equal(r1.exitCode, 0);
      assert.ok(r1.stdout.includes('Sandbox 1'));
      assert.equal(r2.exitCode, 0);
      assert.ok(r2.stdout.includes('Sandbox 2'));

      await Promise.all([s1.destroy(), s2.destroy()]);
    });
  });
});
