/**
 * Unit Test Suite for GitHub MCP Automation & Rich PR Generator
 */

import * as assert from 'node:assert';
import { GitHubMCPClient } from '../client.ts';
import { generatePRBody, generatePRTitle, parseDiffStatistics } from '../pr-generator.ts';
import { calculateQodoScorecard } from '../../qodo/scorecard.ts';

export async function runGitHubMCPTests() {
  console.log('\n--- Running GitHub MCP Unit Tests ---');
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}:`, err);
      failed++;
    }
  };

  // =========================================================================
  // 1. GitHubMCPClient Initialization & Mode Selection
  // =========================================================================
  await test('GitHubMCPClient initializes in mock mode by default when token is mock or missing', () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    assert.strictEqual(client.getMode(), 'mock');
  });

  await test('GitHubMCPClient supports mode switching and configuration', () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    client.setMode('local_git');
    assert.strictEqual(client.getMode(), 'local_git');
    client.setMode('mock');
  });

  // =========================================================================
  // 2. MCP Tools: create_branch, create_or_update_file, create_pull_request
  // =========================================================================
  await test('createBranch creates a new branch ref and resolves collisions', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const b1 = await client.createBranch({
      owner: 'truefoundry',
      repo: 'openheal',
      branch: 'openheal/fix-auth'
    });

    assert.ok(b1.ref.startsWith('refs/heads/openheal/fix-auth'));
    assert.ok(b1.object.sha.length > 0);

    // Create same branch again - collision resolver should append suffix
    const b2 = await client.createBranch({
      owner: 'truefoundry',
      repo: 'openheal',
      branch: 'openheal/fix-auth'
    });

    assert.ok(b2.ref.startsWith('refs/heads/openheal/fix-auth-'));
  });

  await test('createOrUpdateFile commits file and returns SHA and file metadata', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const res = await client.createOrUpdateFile({
      owner: 'truefoundry',
      repo: 'openheal',
      branch: 'openheal/fix-auth',
      path: 'src/auth.py',
      content: 'def verify_token(): return True',
      message: 'fix(auth): fix token expiration check'
    });

    assert.strictEqual(res.content.name, 'auth.py');
    assert.strictEqual(res.content.path, 'src/auth.py');
    assert.ok(res.content.sha.length > 0);
    assert.ok(res.commit.sha.length > 0);
  });

  await test('commitFiles commits multiple files sequentially to feature branch', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const results = await client.commitFiles(
      'truefoundry',
      'openheal',
      'openheal/fix-auth',
      [
        { path: 'src/auth.py', content: 'def verify(): pass' },
        { path: 'tests/test_auth.py', content: 'def test_verify(): pass' }
      ],
      'fix(auth): batch patch application'
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].content.name, 'auth.py');
    assert.strictEqual(results[1].content.name, 'test_auth.py');
  });

  await test('createPullRequest opens PR with title, body, head, base', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const pr = await client.createPullRequest({
      owner: 'truefoundry',
      repo: 'openheal',
      title: 'fix(auth): fix token validation boundary',
      head: 'openheal/fix-auth',
      base: 'main',
      body: '## OpenHeal Fix Report'
    });

    assert.strictEqual(pr.state, 'open');
    assert.strictEqual(pr.title, 'fix(auth): fix token validation boundary');
    assert.ok(pr.html_url.includes('/pull/'));
    assert.strictEqual(pr.head.ref, 'openheal/fix-auth');
    assert.strictEqual(pr.base.ref, 'main');
  });

  await test('getFileContents and listBranches return correct repository state', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    await client.createOrUpdateFile({
      owner: 'truefoundry',
      repo: 'openheal',
      branch: 'main',
      path: 'README.md',
      content: '# OpenHeal Repository',
      message: 'initial commit'
    });

    const file = await client.getFileContents({
      owner: 'truefoundry',
      repo: 'openheal',
      path: 'README.md',
      branch: 'main'
    });

    assert.strictEqual(file.content, '# OpenHeal Repository');

    const branches = await client.listBranches({ owner: 'truefoundry', repo: 'openheal' });
    assert.ok(branches.length >= 1);
  });

  await test('callTool dispatches standard MCP tool calls dynamically', async () => {
    const client = new GitHubMCPClient({ mode: 'mock' });
    const res = await client.callTool('create_branch', {
      owner: 'truefoundry',
      repo: 'openheal',
      branch: 'openheal/dynamic-branch'
    }) as { ref: string };

    assert.ok(res.ref.includes('openheal/dynamic-branch'));

    await assert.rejects(async () => {
      await client.callTool('unsupported_tool', {});
    }, /Unsupported MCP tool/);
  });

  // =========================================================================
  // 3. Rich Pull Request Body & Title Generator
  // =========================================================================
  await test('generatePRTitle formats Conventional Commits style title', () => {
    const t1 = generatePRTitle({ scope: 'auth', description: 'resolve token expiration off-by-one' });
    assert.strictEqual(t1, 'fix(auth): resolve token expiration off-by-one');

    const t2 = generatePRTitle({ type: 'perf', description: 'optimize AST search cache' });
    assert.strictEqual(t2, 'perf: optimize AST search cache');
  });

  await test('parseDiffStatistics calculates additions, deletions, and file lists accurately', () => {
    const diff = `
--- a/src/auth.py
+++ b/src/auth.py
@@ -10,3 +10,5 @@
 def verify(token):
-    return token.exp > now
+    if not token:
+        return False
+    return token.exp >= now
--- a/tests/test_auth.py
+++ b/tests/test_auth.py
@@ -1,2 +1,4 @@
+def test_empty():
+    assert not verify(None)
`;
    const stats = parseDiffStatistics(diff);
    assert.strictEqual(stats.filesChanged, 2);
    assert.strictEqual(stats.additions, 5);
    assert.strictEqual(stats.deletions, 1);
    assert.deepStrictEqual(stats.fileList.sort(), ['src/auth.py', 'tests/test_auth.py'].sort());
  });

  await test('generatePRBody generates complete, audit-ready markdown report', () => {
    const scorecard = calculateQodoScorecard({
      originalCode: 'def calc(a, b): return a / b',
      healedCode: 'def calc(a, b):\n    if b == 0: raise ValueError("Zero")\n    return a / b',
      language: 'python'
    });

    const body = generatePRBody({
      owner: 'truefoundry',
      repo: 'openheal-demo',
      filePath: 'src/calc.py',
      lineNumber: 18,
      errorMessage: 'ZeroDivisionError: division by zero',
      rootCauseExplanation: 'Missing divisor validation when b is zero.',
      astNodeType: 'FunctionDeclaration',
      scorecard,
      baselineExitCode: 1,
      baselineErrorLogSnippet: 'FAILED tests/test_calc.py::test_divide - ZeroDivisionError: division by zero',
      verificationLogSnippet: '✓ tests/test_calc.py::test_divide PASSED [100%]\n====== 1 passed in 0.02s ======',
      generatedTestCode: 'def test_divide_zero():\n    with pytest.raises(ValueError):\n        calc(10, 0)',
      language: 'python',
      approverName: 'Alice Security Lead',
      approvalTimestamp: '2026-08-28T23:30:00Z',
      resumeToken: 'tf_resume_token_mock_99182',
      diff: '@@ -1 +1,3 @@\n+ if b == 0: raise ValueError()\n  return a / b',
      branch: 'openheal/fix-calc-div-zero',
      durationMs: 3820
    });

    assert.ok(body.includes('## 🩺 OpenHeal Autonomous Self-Healing Report'));
    assert.ok(body.includes('`truefoundry/openheal-demo`'));
    assert.ok(body.includes('`src/calc.py:18`'));
    assert.ok(body.includes('ZeroDivisionError'));
    assert.ok(body.includes('🛡️ Qodo Code Quality & Security Scorecard'));
    assert.ok(body.includes('Daytona Sandbox Verification Results'));
    assert.ok(body.includes('Qodo Cover Generated Reproduction Tests'));
    assert.ok(body.includes('Alice Security Lead'));
    assert.ok(body.includes('tf_resume_token_mock_99182'));
  });

  console.log(`\nGitHub MCP Tests Completed: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

// Self-run
runGitHubMCPTests().catch(err => {
  console.error('Fatal GitHub MCP test exception:', err);
  process.exit(1);
});
