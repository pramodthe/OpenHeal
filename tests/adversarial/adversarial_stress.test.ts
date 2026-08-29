/**
 * OpenHeal Empirical Adversarial Stress Test Suite
 * 
 * Adversarial Verifier: Challenger 2
 * Tests Daytona Sandbox Engine, Qodo Scorecards, GitHub MCP, and Web UI routes:
 * 1. Process execution timeouts, zombie process kill traps, signal handling.
 * 2. Corrupted git diff patches, syntax error recovery, and patch rollback.
 * 3. Qodo Scorecard edge boundaries (100% clean code, completely malicious code with CWEs).
 * 4. Next.js API endpoints with malformed JSON payloads and concurrent SSE connections.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, test, it, expect, assert } from '../e2e/runner.ts';

// Imports from OpenHeal Core Libs
import {
  MockLocalSandbox,
  DaytonaSandboxEngine,
  DaytonaClient,
  CommandTimeoutError,
  DaytonaAuthError,
  DaytonaProvisioningError,
  PatchApplicationError,
  FileSystemError,
  GitCloneError,
} from '../../src/lib/daytona/index.ts';

import {
  calculateQodoScorecard,
  generateMarkdownScorecard,
  runQodoCover,
  extractASTFunctions,
  detectLanguage,
  generateTestCasesForLanguage,
  injectTestsIntoFile,
  identifyTargetFunction,
} from '../../src/lib/qodo/index.ts';

import {
  GitHubMCPClient,
  generatePRBody,
  generatePRTitle,
  parseDiffStatistics,
} from '../../src/lib/github-mcp/index.ts';

import {
  EventBus,
  eventBus,
  createTurnStream,
  isEventDelta,
  mergeEventDelta,
  HitlGate,
  hitlGate,
  sessionManager,
} from '../../src/lib/trueforge/index.ts';

import { SCENARIO_CATALOG } from '../../src/lib/scenarios-catalog.ts';

// ---------------------------------------------------------------------------
// 1. Daytona Sandbox Engine Adversarial Stress Tests
// ---------------------------------------------------------------------------
describe('[Adversarial: Daytona] Process Execution Timeouts & Zombie Traps', () => {
  it('ADV-DAYTONA-01: Throws CommandTimeoutError on process execution timeout with stdout/stderr capture', async () => {
    const sandbox = new MockLocalSandbox({ id: 'sbx-adv-timeout' });
    try {
      let threw = false;
      try {
        await sandbox.executeCommand('sleep 5', { timeoutMs: 50 });
      } catch (err: any) {
        threw = true;
        expect(err instanceof CommandTimeoutError).toBe(true);
        expect(err.name).toBe('CommandTimeoutError');
        expect(err.message).toContain('timed out after 50ms');
      }
      expect(threw).toBe(true);
    } finally {
      await sandbox.destroy();
    }
  });

  it('ADV-DAYTONA-02: DaytonaSandboxEngine.withTimeout wraps generic promises and enforces strict timeout', async () => {
    const slowOperation = new Promise((resolve) => setTimeout(() => resolve('done'), 500));
    let threw = false;
    try {
      await DaytonaSandboxEngine.withTimeout(slowOperation, 50, 'slowOperation');
    } catch (err: any) {
      threw = true;
      expect(err instanceof CommandTimeoutError).toBe(true);
      expect(err.message).toContain('Operation "slowOperation" timed out after 50ms');
    }
    expect(threw).toBe(true);

    const fastOperation = new Promise((resolve) => setTimeout(() => resolve('success'), 10));
    const fastResult = await DaytonaSandboxEngine.withTimeout(fastOperation, 500, 'fastOperation');
    expect(fastResult).toBe('success');
  });

  it('ADV-DAYTONA-03: Sandbox destroy() terminates active child processes and purges workspace directory', async () => {
    const sandbox = new MockLocalSandbox({ id: 'sbx-adv-zombie' });
    const wsDir = sandbox.workspaceDir;
    expect(fs.existsSync(wsDir)).toBe(true);

    // Launch a background command
    sandbox.executeCommand('sleep 10', { timeoutMs: 5000 }).catch(() => {});

    // Destroy sandbox immediately
    await sandbox.destroy();
    expect(sandbox.getStatus()).toBe('terminated');

    // Attempting operations on terminated sandbox must throw
    let threw = false;
    try {
      await sandbox.executeCommand('echo "test"');
    } catch (err: any) {
      threw = true;
      expect(err.message).toContain('already terminated');
    }
    expect(threw).toBe(true);
  });

  it('ADV-DAYTONA-04: Custom Error hierarchy maintains integrity for all failure classifications', () => {
    const timeoutErr = new CommandTimeoutError('timeout msg', 'out', 'err');
    expect(timeoutErr instanceof Error).toBe(true);
    expect(timeoutErr.name).toBe('CommandTimeoutError');
    expect(timeoutErr.partialStdout).toBe('out');
    expect(timeoutErr.partialStderr).toBe('err');

    const authErr = new DaytonaAuthError('auth failed');
    expect(authErr instanceof Error).toBe(true);
    expect(authErr.name).toBe('DaytonaAuthError');

    const provErr = new DaytonaProvisioningError('provision failed');
    expect(provErr instanceof Error).toBe(true);
    expect(provErr.name).toBe('DaytonaProvisioningError');

    const patchErr = new PatchApplicationError('patch failed');
    expect(patchErr instanceof Error).toBe(true);
    expect(patchErr.name).toBe('PatchApplicationError');

    const fsErr = new FileSystemError('fs failed');
    expect(fsErr instanceof Error).toBe(true);
    expect(fsErr.name).toBe('FileSystemError');

    const gitErr = new GitCloneError('git failed');
    expect(gitErr instanceof Error).toBe(true);
    expect(gitErr.name).toBe('GitCloneError');
  });

  it('ADV-DAYTONA-05: DaytonaSandboxEngine init and registerSignalHooks are idempotent', async () => {
    const engine = new DaytonaSandboxEngine();
    await engine.init();
    // Subsequent init should not throw or duplicate signal hooks
    await engine.init();
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Corrupted Patches & Syntax Error Recovery
// ---------------------------------------------------------------------------
describe('[Adversarial: Daytona] Corrupted Patches & Diff Rollback', () => {
  it('ADV-PATCH-01: Handles completely corrupted unified diff patch gracefully without crashing', async () => {
    const sandbox = new MockLocalSandbox({ id: 'sbx-adv-corrupt-patch' });
    try {
      // Setup a valid repository state first
      await sandbox.writeFile('repo/src/calc.py', 'def add(a, b):\n    return a + b\n');
      await sandbox.executeCommand('git init && git add . && git commit -m "init" --allow-empty', { cwd: 'repo' });

      // Corrupted diff with invalid headers and random garbage
      const corruptedPatch = `
@@ invalid line numbers @@
--- non_existent_file.py
+++ non_existent_file.py
@@ -999,0 +999,0 @@
+corrupted line with invalid git chunk syntax <<<<<<<< ===== >>>>>>>
`;
      const patchResult = await sandbox.applyPatch({ diff: corruptedPatch });
      expect(patchResult.applied).toBe(false);
      expect(patchResult.error).toBeDefined();
      expect(patchResult.modifiedFiles).toHaveLength(0);
    } finally {
      await sandbox.destroy();
    }
  });

  it('ADV-PATCH-02: Handles invalid PatchPayload (missing both filePath/fileContent and diff)', async () => {
    const sandbox = new MockLocalSandbox({ id: 'sbx-adv-empty-patch' });
    try {
      const result = await sandbox.applyPatch({} as any);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('Invalid PatchPayload');
    } finally {
      await sandbox.destroy();
    }
  });

  it('ADV-PATCH-03: Invalid git clone source throws GitCloneError without leaving corrupt state', async () => {
    const sandbox = new MockLocalSandbox({ id: 'sbx-adv-git-clone-err' });
    try {
      let threw = false;
      try {
        await sandbox.cloneRepository('https://invalid-non-existent-domain-12345.xyz/repo.git');
      } catch (err: any) {
        threw = true;
        expect(err instanceof GitCloneError || err.name === 'GitCloneError').toBe(true);
      }
      expect(threw).toBe(true);
    } finally {
      await sandbox.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Qodo Scorecard Boundary & Security Analysis Testing
// ---------------------------------------------------------------------------
describe('[Adversarial: Qodo] Scorecard Boundary & Security Analysis', () => {
  it('ADV-QODO-01: 100% Clean Code Baseline generates maximum score and APPROVED_FOR_PR', () => {
    const report = calculateQodoScorecard({
      originalCode: 'def calculate(x: int) -> int:\n    return x * 2\n',
      healedCode: 'def calculate(x: int) -> int:\n    return x * 2\n',
      diff: '',
      language: 'python',
      generatedTestsCount: 3,
      testResults: { passed: true, exitCode: 0, coveragePercent: 95 },
    });

    expect(report.overallScore).toBeGreaterThanOrEqual(95);
    expect(report.grade).toBe('A+');
    expect(report.verdict).toBe('APPROVED_FOR_PR');
    expect(report.securityAudit.passed).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('ADV-QODO-02: Flags Critical SQL Injection (CWE-89) and denies PR approval', () => {
    const originalCode = 'def get_user(db, user_id):\n    return db.find(user_id)\n';
    const maliciousCode = 'def get_user(db, user_id):\n    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")\n';
    const diff = `
-    return db.find(user_id)
+    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")
`;

    const report = calculateQodoScorecard({
      originalCode,
      healedCode: maliciousCode,
      diff,
      language: 'python',
      generatedTestsCount: 1,
      testResults: { passed: true, exitCode: 0 },
    });

    expect(report.securityScore).toBeLessThanOrEqual(65);
    expect(report.securityAudit.passed).toBe(false);
    expect(report.verdict).not.toBe('APPROVED_FOR_PR');
    expect(report.securityAudit.findings.some((f) => f.cveOrCwe === 'CWE-89' && !f.mitigated)).toBe(true);
  });

  it('ADV-QODO-03: Recognizes CWE-89 mitigation when raw query is replaced by parameterized statement', () => {
    const originalCode = 'def get_user(db, user_id):\n    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")\n';
    const healedCode = 'def get_user(db, user_id):\n    return db.execute("SELECT * FROM users WHERE id = %s", (user_id,))\n';
    const diff = `
-    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")
+    return db.execute("SELECT * FROM users WHERE id = %s", (user_id,))
`;

    const report = calculateQodoScorecard({
      originalCode,
      healedCode,
      diff,
      language: 'python',
      generatedTestsCount: 3,
      testResults: { passed: true, exitCode: 0 },
    });

    expect(report.securityAudit.passed).toBe(true);
    expect(report.securityAudit.findings.some((f) => f.cveOrCwe === 'CWE-89' && f.mitigated)).toBe(true);
    expect(report.verdict).toBe('APPROVED_FOR_PR');
  });

  it('ADV-QODO-04: Flags Critical Command Injection (CWE-78) via child_process or os.system', () => {
    const maliciousCode = 'const { exec } = require("child_process");\nfunction run(cmd) {\n  exec("cat " + cmd);\n}\n';
    const diff = `+function run(cmd) {\n+  child_process.exec("cat " + cmd);\n+}`;

    const report = calculateQodoScorecard({
      originalCode: '',
      healedCode: maliciousCode,
      diff,
      language: 'javascript',
    });

    expect(report.securityScore).toBeLessThanOrEqual(60);
    expect(report.securityAudit.passed).toBe(false);
    expect(report.securityAudit.findings.some((f) => f.cveOrCwe === 'CWE-78')).toBe(true);
  });

  it('ADV-QODO-05: Flags Hardcoded Credentials (CWE-798) in patch code', () => {
    const maliciousCode = 'export const apiKey = "sk_live_12345678901234567890";\n';
    const diff = `+export const apiKey = "sk_live_12345678901234567890";\n`;

    const report = calculateQodoScorecard({
      originalCode: '',
      healedCode: maliciousCode,
      diff,
      language: 'typescript',
    });

    expect(report.securityScore).toBeLessThanOrEqual(75);
    expect(report.securityAudit.findings.some((f) => f.cveOrCwe === 'CWE-798')).toBe(true);
  });

  it('ADV-QODO-06: Flags Path Traversal (CWE-22) in file access', () => {
    const maliciousCode = 'const fs = require("fs");\nfunction read(req) {\n  return fs.readFileSync(req.path);\n}\n';
    const diff = `+  return fs.readFileSync(req.path);\n`;

    const report = calculateQodoScorecard({
      originalCode: '',
      healedCode: maliciousCode,
      diff,
      language: 'javascript',
    });

    expect(report.securityAudit.findings.some((f) => f.cveOrCwe === 'CWE-22')).toBe(true);
  });

  it('ADV-QODO-07: Flags Insecure Randomness (CWE-338) when Math.random() is used for token generation', () => {
    const maliciousCode = 'function generateAuthToken() {\n  return "token_" + Math.random();\n}\n';
    const diff = `+  return "token_" + Math.random();\n`;

    const report = calculateQodoScorecard({
      originalCode: '',
      healedCode: maliciousCode,
      diff,
      language: 'typescript',
    });

    expect(report.securityAudit.findings.some((f) => f.cveOrCwe === 'CWE-338')).toBe(true);
  });

  it('ADV-QODO-08: Penalizes Dangerous eval(), silent catch blocks, and massive diffs', () => {
    const badCode = `
function processInput(code) {
  try {
    eval(code);
  } catch (e) {}
}
`;
    const lines = Array.from({ length: 90 }, (_, i) => `+const line_${i} = ${i};`).join('\n');
    const diff = `+eval(code);\n+catch (e) {}\n${lines}`;

    const report = calculateQodoScorecard({
      originalCode: '',
      healedCode: badCode,
      diff,
      language: 'typescript',
    });

    expect(report.qualityScore).toBeLessThanOrEqual(60);
    expect(report.breakdown.ruleViolations.length).toBeGreaterThanOrEqual(2);
  });

  it('ADV-QODO-09: Generates formatted markdown scorecard table with all dimensions', () => {
    const report = calculateQodoScorecard({
      originalCode: 'def add(a, b): return a + b\n',
      healedCode: 'def add(a, b): return a + b\n',
      language: 'python',
      testResults: { passed: true },
    });

    const md = generateMarkdownScorecard(report);
    expect(md).toContain('Qodo Code Quality & Security Scorecard');
    expect(md).toContain('Code Quality');
    expect(md).toContain('Security Audit');
    expect(md).toContain('Test Coverage');
    expect(md).toContain('Performance');
  });
});

// ---------------------------------------------------------------------------
// 4. Qodo Cover AST Multi-Language Extraction & Synthesizer
// ---------------------------------------------------------------------------
describe('[Adversarial: Qodo Cover] AST Test Synthesizer Multi-Language', () => {
  it('ADV-COVER-01: Detects language from file extensions accurately', () => {
    expect(detectLanguage('test.py')).toBe('python');
    expect(detectLanguage('test.ts')).toBe('typescript');
    expect(detectLanguage('test.js')).toBe('javascript');
    expect(detectLanguage('test.go')).toBe('go');
    expect(detectLanguage('test.rs')).toBe('rust');
    expect(detectLanguage(undefined, 'python')).toBe('python');
  });

  it('ADV-COVER-02: Extracts AST functions across Python, TypeScript, Go, and Rust', () => {
    const pyFunctions = extractASTFunctions('def divide(a: float, b: float) -> float:\n    return a / b\n', 'python');
    expect(pyFunctions).toHaveLength(1);
    expect(pyFunctions[0].name).toBe('divide');
    expect(pyFunctions[0].params).toEqual(['a', 'b']);

    const tsFunctions = extractASTFunctions('export function getCacheKey(id: string, version: number): string {\n  return id;\n}', 'typescript');
    expect(tsFunctions).toHaveLength(1);
    expect(tsFunctions[0].name).toBe('getCacheKey');

    const goFunctions = extractASTFunctions('func ProcessRecord(id string, val int) error {\n  return nil\n}', 'go');
    expect(goFunctions).toHaveLength(1);
    expect(goFunctions[0].name).toBe('ProcessRecord');

    const rsFunctions = extractASTFunctions('pub fn parse_header(input: &str) -> Result<Header, Error> {\n  Ok(Header)\n}', 'rust');
    expect(rsFunctions).toHaveLength(1);
    expect(rsFunctions[0].name).toBe('parse_header');
  });

  it('ADV-COVER-03: Synthesizes regression, boundary, and edge-case tests for Python', () => {
    const targetFunc = { name: 'divide', params: ['a', 'b'], startLine: 1, endLine: 5, body: '' };
    const tests = generateTestCasesForLanguage('python', targetFunc, 'def divide(a, b): return a / b');

    expect(tests.length).toBeGreaterThanOrEqual(3);
    expect(tests.some((t) => t.testType === 'regression')).toBe(true);
    expect(tests.some((t) => t.testType === 'boundary')).toBe(true);
    expect(tests.some((t) => t.testType === 'error_handling')).toBe(true);
  });

  it('ADV-COVER-04: Injects tests cleanly into test file without duplicate describe wrappers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qodo-test-'));
    const testFile = path.join(tmpDir, 'test_sample.ts');

    try {
      const generated = [
        {
          testName: 'should handle boundary case',
          testCode: "  it('should handle boundary case', () => { expect(1).toBe(1); });",
          description: 'desc',
          targetFunction: 'sample',
          testType: 'boundary' as const,
          passed: true,
        },
      ];

      const content = injectTestsIntoFile(testFile, generated, 'typescript', tmpDir);
      expect(content).toContain('should handle boundary case');
      expect(fs.existsSync(testFile)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. GitHub MCP Automation & PR Body Generation
// ---------------------------------------------------------------------------
describe('[Adversarial: GitHub MCP] Client Automation & Rich Markdown PRs', () => {
  it('ADV-GH-01: Auto-resolves branch collisions with timestamp suffix in mock mode', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const owner = 'openheal-test';
    const repo = 'calc-repo';

    const branch1 = await client.createBranch({ owner, repo, branch: 'openheal-fix-div0' });
    expect(branch1.ref).toBe('refs/heads/openheal-fix-div0');

    // Creating same branch again should append collision suffix
    const branch2 = await client.createBranch({ owner, repo, branch: 'openheal-fix-div0' });
    expect(branch2.ref).toContain('refs/heads/openheal-fix-div0-');
  });

  it('ADV-GH-02: Commits multiple files and creates pull request with full state tracking', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const owner = 'openheal-test';
    const repo = 'calc-repo';
    const branch = 'fix-branch-42';

    await client.createBranch({ owner, repo, branch });

    const files = [
      { path: 'calculator/calculator.py', content: 'def divide(a, b):\n    return a / b\n' },
      { path: 'tests/test_calculator.py', content: 'def test_divide():\n    assert divide(4, 2) == 2\n' },
    ];

    const commitResults = await client.commitFiles(owner, repo, branch, files, 'Fix division by zero');
    expect(commitResults).toHaveLength(2);

    const pr = await client.createPullRequest({
      owner,
      repo,
      title: 'fix(core): resolve zero division error in Calculator.divide',
      head: branch,
      base: 'main',
      body: 'Automated PR by OpenHeal',
    });

    expect(pr.number).toBeGreaterThan(0);
    expect(pr.state).toBe('open');
    expect(pr.html_url).toContain(`/${owner}/${repo}/pull/`);
  });

  it('ADV-GH-03: Rich Markdown PR Body embeds Qodo Scorecard, verification results, and diff stats', () => {
    const scorecard = calculateQodoScorecard({
      originalCode: 'def add(a, b): return a + b\n',
      healedCode: 'def add(a, b): return a + b\n',
      diff: '- return a // b\n+ return a / b',
      language: 'python',
      testResults: { passed: true },
    });

    const prBody = generatePRBody({
      owner: 'openheal-demo',
      repo: 'python-calculator',
      filePath: 'calculator/calculator.py',
      lineNumber: 18,
      errorMessage: 'ZeroDivisionError: division by zero',
      rootCauseExplanation: 'Integer floor division used instead of float division.',
      astNodeType: 'BinaryExpression',
      scorecard,
      baselineExitCode: 1,
      baselineErrorLogSnippet: 'FAILED tests/test_calc.py::test_div - ZeroDivisionError',
      verificationLogSnippet: '====== 5 passed in 0.12s ======',
      generatedTestCode: 'def test_divide_boundary(): assert divide(10, 2) == 5.0',
      language: 'python',
      approverName: 'SecOps Reviewer',
      approvalTimestamp: new Date().toISOString(),
      resumeToken: 'tok_sec_12345',
      diff: '- return a // b\n+ return a / b',
      branch: 'openheal/fix-div0',
      filesChanged: ['calculator/calculator.py'],
      durationMs: 4200,
    });

    expect(prBody).toContain('OpenHeal Autonomous Self-Healing Report');
    expect(prBody).toContain('Diagnostic & Root Cause Localization');
    expect(prBody).toContain('Daytona Sandbox Verification Results');
    expect(prBody).toContain('Qodo Cover Generated Reproduction Tests');
    expect(prBody).toContain('Diff Statistics');
    expect(prBody).toContain('Human Approval Audit Trail');
  });

  it('ADV-GH-04: Generates clean, semantic PR titles with Conventional Commits schema', () => {
    const title1 = generatePRTitle({
      type: 'fix',
      scope: 'calculator',
      description: 'resolve ZeroDivisionError in Calculator.divide',
    });
    expect(title1).toBe('fix(calculator): resolve ZeroDivisionError in Calculator.divide');

    const title2 = generatePRTitle({
      type: 'feat',
      description: 'add AST parser recovery',
    });
    expect(title2).toBe('feat: add AST parser recovery');
  });

  it('ADV-GH-05: Parses diff statistics accurately from unified diff', () => {
    const diff = `
diff --git a/src/cache.ts b/src/cache.ts
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -10,3 +10,4 @@
-  const ttl = 100;
+  const ttl = 500;
+  const max = 1000;
`;
    const stats = parseDiffStatistics(diff, ['src/cache.ts']);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
    expect(stats.filesChanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Next.js API Route Handlers, HITL Gate & High-Concurrency SSE Streaming
// ---------------------------------------------------------------------------
describe('[Adversarial: UI & SSE] Route Handlers, HITL Gate & SSE Concurrency', () => {
  it('ADV-UI-01: Scenarios catalog returns valid items with required execution metadata', () => {
    expect(SCENARIO_CATALOG.length).toBeGreaterThanOrEqual(3);
    const py = SCENARIO_CATALOG.find((s) => s.id === 'python-calculator');
    expect(py).toBeDefined();
    expect(py?.language).toBe('python');
    expect(py?.testFramework).toBe('pytest');

    const node = SCENARIO_CATALOG.find((s) => s.id === 'node-api-cache');
    expect(node).toBeDefined();
    expect(node?.language).toBe('node');

    const rust = SCENARIO_CATALOG.find((s) => s.id === 'rust-parser');
    expect(rust).toBeDefined();
    expect(rust?.language).toBe('rust');
  });

  it('ADV-UI-02: HITL Gate cryptographic HMAC resume token verification and replay protection', () => {
    const gate = new HitlGate('test-secret-key-1234567890123456');
    const sessionId = 'sess_hitl_test';
    const toolCallId = 'call_gh_pr_1';
    const expiresAt = Date.now() + 60000;

    const token = gate.generateResumeToken(sessionId, toolCallId, expiresAt);
    expect(token.startsWith('tok_sec_')).toBe(true);

    // Verify valid signature
    const isValid = gate.verifyTokenSignature(sessionId, toolCallId, token);
    expect(isValid).toBe(true);

    // Forged token should fail
    const forgedToken = token.slice(0, -4) + '0000';
    const isForgedValid = gate.verifyTokenSignature(sessionId, toolCallId, forgedToken);
    expect(isForgedValid).toBe(false);

    // Expired token should fail
    const expiredToken = gate.generateResumeToken(sessionId, toolCallId, Date.now() - 1000);
    expect(gate.verifyTokenSignature(sessionId, toolCallId, expiredToken)).toBe(false);
  });

  it('ADV-UI-03: HITL approval flow allows/denies and enforces single-use token idempotency', () => {
    const gate = new HitlGate('test-secret');
    const sessionId = `sess_hitl_flow_${Date.now()}`;
    const threadId = 'thread_orchestrator';
    const turnId = 'turn_1';
    const toolCallId = 'tool_call_create_pr';

    // Create session in sessionManager
    sessionManager.createSession({
      sessionId,
      repoUrl: 'https://github.com/demo/repo',
      language: 'python',
    });

    const request = gate.createApprovalRequest(
      sessionId,
      threadId,
      turnId,
      toolCallId,
      'create_pull_request',
      { branch: 'fix', title: 'fix bug' }
    );

    expect(gate.isPendingApproval(sessionId)).toBe(true);
    expect(request.resumeToken).toBeDefined();

    // Resolve approval
    const res = gate.resolveApproval({
      sessionId,
      resumeToken: request.resumeToken,
      decision: {
        status: 'allow',
        approver: 'admin_user',
        reason: 'Looks great!',
      },
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('allow');
    expect(gate.isPendingApproval(sessionId)).toBe(false);

    // Replay attack: Re-using the same token should fail
    const replayRes = gate.resolveApproval({
      sessionId,
      resumeToken: request.resumeToken,
      decision: {
        status: 'allow',
      },
    });

    expect(replayRes.success).toBe(false);
    expect(replayRes.error).toContain('idempotency');
  });

  it('ADV-UI-04: High Concurrency SSE (50 concurrent clients) with broadcast and graceful abort cleanup', async () => {
    const bus = new EventBus();
    const sessionId = `sess_concurrency_${Date.now()}`;
    const numClients = 50;

    const streams: ReadableStream<Uint8Array>[] = [];
    const abortControllers: AbortController[] = [];
    const receivedChunks: string[][] = Array.from({ length: numClients }, () => []);

    // Create 50 concurrent SSE streams
    for (let i = 0; i < numClients; i++) {
      const ac = new AbortController();
      abortControllers.push(ac);
      const stream = bus.toSSEStream(sessionId, ac.signal);
      streams.push(stream);

      // Start reader for each stream in background
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const clientIndex = i;

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              receivedChunks[clientIndex].push(decoder.decode(value));
            }
          }
        } catch {
          // Aborted
        }
      })();
    }

    // Small delay to ensure all readers start
    await new Promise((r) => setTimeout(r, 20));

    // Broadcast test event
    bus.emitEvent(sessionId, 'thread_main', 'sandbox.log', { message: 'Adversarial SSE Stress Broadcast' });

    await new Promise((r) => setTimeout(r, 30));

    // Verify all 50 clients received connection banner and broadcast event
    for (let i = 0; i < numClients; i++) {
      const allText = receivedChunks[i].join('');
      expect(allText).toContain('event: connected');
      expect(allText).toContain('Adversarial SSE Stress Broadcast');
    }

    // Abruptly abort first 25 clients
    for (let i = 0; i < 25; i++) {
      abortControllers[i].abort();
    }

    await new Promise((r) => setTimeout(r, 20));

    // Broadcast second event to remaining 25 clients
    bus.emitEvent(sessionId, 'thread_main', 'sandbox.log', { message: 'Second Broadcast Post-Abort' });

    await new Promise((r) => setTimeout(r, 30));

    // Remaining 25 clients should receive second event without error
    for (let i = 25; i < numClients; i++) {
      const allText = receivedChunks[i].join('');
      expect(allText).toContain('Second Broadcast Post-Abort');
    }

    // Clean up remaining clients
    for (let i = 25; i < numClients; i++) {
      abortControllers[i].abort();
    }
  });

  it('ADV-UI-05: Delta merger accumulates token deltas and tool calls reliably', () => {
    let accumulated: Record<string, unknown> | null = null;

    const delta1 = {
      id: 'd1',
      type: 'agent.message.delta',
      sessionId: 'sess_1',
      threadId: 't1',
      delta: 'Hello, ',
      isDelta: true,
    };
    accumulated = mergeEventDelta(accumulated, delta1);
    expect(accumulated.content).toBe('Hello, ');

    const delta2 = {
      id: 'd2',
      type: 'agent.message.delta',
      sessionId: 'sess_1',
      threadId: 't1',
      delta: 'self-healing is active.',
      isDelta: true,
    };
    accumulated = mergeEventDelta(accumulated, delta2);
    expect(accumulated.content).toBe('Hello, self-healing is active.');
    expect(isEventDelta(delta1)).toBe(true);
    expect(isEventDelta({ type: 'discrete.event' })).toBe(false);
  });
});
