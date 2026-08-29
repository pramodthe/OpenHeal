/**
 * Comprehensive Unit Test Suite for TrueForge Agent Harness & Subagent Swarm
 */

import assert from 'node:assert/strict';
import {
  sessionManager,
  eventBus,
  hitlGate,
  harness,
  diagnosticSubagent,
  patchSynthesizerSubagent,
  regressionVerifierSubagent,
  isEventDelta,
  mergeEventDelta,
  createTurnStream,
  type ISandboxInstance,
  type CommandResult,
} from './index.ts';

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(err.stack || err);
    throw err;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('Running TrueForge Runtime & Swarm Unit Tests');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // Group 1: Session Management & Thread Isolation
  // --------------------------------------------------------------------------
  console.log('Group 1: Session Management & Thread Isolation');

  await test('SessionManager creates session with default configuration', () => {
    sessionManager.clear();
    const session = sessionManager.createSession({
      repoUrl: 'https://github.com/org/broken-calculator',
      language: 'python',
    });

    assert.ok(session.config.sessionId.startsWith('sess_'));
    assert.equal(session.config.repoUrl, 'https://github.com/org/broken-calculator');
    assert.equal(session.status, 'INIT');
    assert.equal(session.config.maxPatchAttempts, 3);
    assert.equal(session.config.autoApprovePR, false);
    assert.equal(session.currentAttempt, 0);
  });

  await test('SessionManager updates session status and audit errors', () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const updated = sessionManager.transitionStatus(session.config.sessionId, 'DIAGNOSING');
    assert.equal(updated.status, 'DIAGNOSING');

    const failed = sessionManager.transitionStatus(session.config.sessionId, 'FAILED', 'Sandbox timeout');
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.errorMessage, 'Sandbox timeout');
  });

  await test('SessionManager enforces isolated thread IDs and event histories', () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;

    const diagThread = sessionManager.createThread(sid, 'diagnostic', 1);
    const patchThread = sessionManager.createThread(sid, 'patcher', 1);

    assert.notEqual(diagThread, patchThread);
    assert.ok(diagThread.includes('diagnostic'));
    assert.ok(patchThread.includes('patcher'));

    sessionManager.appendThreadEvent(sid, diagThread, {
      type: 'agent.thought',
      sessionId: sid,
      threadId: diagThread,
      timestamp: new Date().toISOString(),
      payload: { thought: 'Analyzing traceback' },
    });

    const diagHistory = sessionManager.getThreadHistory(sid, diagThread);
    const patchHistory = sessionManager.getThreadHistory(sid, patchThread);

    assert.equal(diagHistory.length, 1);
    assert.equal(patchHistory.length, 0);
  });

  await test('SessionManager serializes and restores full session state', () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;
    const threadId = sessionManager.createThread(sid, 'diagnostic', 1);

    sessionManager.appendThreadEvent(sid, threadId, {
      type: 'agent.status',
      sessionId: sid,
      threadId,
      timestamp: new Date().toISOString(),
      payload: { status: 'running' },
    });

    const json = sessionManager.serializeSession(sid);
    assert.ok(json.length > 50);

    // Delete and restore
    sessionManager.deleteSession(sid);
    assert.equal(sessionManager.getSession(sid), undefined);

    const restored = sessionManager.deserializeSession(json);
    assert.equal(restored.config.sessionId, sid);
    assert.equal(sessionManager.getThreadHistory(sid, threadId).length, 1);
  });

  // --------------------------------------------------------------------------
  // Group 2: Event Bus & Delta Streaming
  // --------------------------------------------------------------------------
  console.log('\nGroup 2: Event Bus & Delta Streaming');

  await test('EventBus emits and filters events by session', () => {
    eventBus.clear();
    const receivedEvents: string[] = [];

    const unsubscribe = eventBus.onSession('sess_100', (event) => {
      receivedEvents.push(event.type);
    });

    eventBus.emitEvent('sess_100', 'thread_1', 'session.started', { repoUrl: 'test' });
    eventBus.emitEvent('sess_200', 'thread_2', 'session.started', { repoUrl: 'test2' });
    eventBus.emitEvent('sess_100', 'thread_1', 'agent.thought', { text: 'thinking' });

    assert.deepEqual(receivedEvents, ['session.started', 'agent.thought']);
    unsubscribe();
  });

  await test('isEventDelta accurately identifies streaming deltas', () => {
    assert.equal(isEventDelta({ type: 'agent.thought.delta', delta: 'chunk' }), true);
    assert.equal(isEventDelta({ type: 'sandbox.log.delta', delta: 'log' }), true);
    assert.equal(isEventDelta({ type: 'custom.event', isDelta: true, delta: 'test' }), true);
    assert.equal(isEventDelta({ type: 'session.started', payload: {} }), false);
    assert.equal(isEventDelta(null), false);
  });

  await test('mergeEventDelta aggregates chunks deterministically', () => {
    let accumulated: any = null;

    accumulated = mergeEventDelta(accumulated, {
      type: 'agent.thought.delta',
      sessionId: 'sess_1',
      threadId: 't1',
      delta: 'Analyzing ',
    });
    assert.equal(accumulated.type, 'agent.thought');
    assert.equal(accumulated.content, 'Analyzing ');

    accumulated = mergeEventDelta(accumulated, {
      type: 'agent.thought.delta',
      sessionId: 'sess_1',
      threadId: 't1',
      delta: 'test failures.',
    });
    assert.equal(accumulated.content, 'Analyzing test failures.');

    // Merge tool call chunk
    accumulated = mergeEventDelta(accumulated, {
      type: 'tool.call.delta',
      sessionId: 'sess_1',
      threadId: 't1',
      toolCallDelta: { name: 'github_', arguments: '{"branch":' },
    });
    accumulated = mergeEventDelta(accumulated, {
      type: 'tool.call.delta',
      sessionId: 'sess_1',
      threadId: 't1',
      toolCallDelta: { name: 'create_pr', arguments: '"fix"}' },
    });

    assert.equal(accumulated.toolCall.name, 'github_create_pr');
    assert.equal(accumulated.toolCall.rawArgs, '{"branch":"fix"}');
  });

  await test('EventBus formats SSE wire messages correctly', () => {
    const sse = eventBus.formatSSEMessage('agent.status', { status: 'running' }, 'ev_123');
    assert.ok(sse.includes('id: ev_123'));
    assert.ok(sse.includes('event: agent.status'));
    assert.ok(sse.includes('data: {"status":"running"}'));
  });

  await test('EventBus supports historical event replay via Last-Event-ID', () => {
    eventBus.clear();
    const sid = 'sess_history_test';
    const ev1 = eventBus.emitEvent(sid, 't1', 'agent.thought', { step: 1 });
    const ev2 = eventBus.emitEvent(sid, 't1', 'agent.thought', { step: 2 });
    const ev3 = eventBus.emitEvent(sid, 't1', 'agent.thought', { step: 3 });

    const replayed = eventBus.getHistory(sid, ev1.id);
    assert.equal(replayed.length, 2);
    assert.equal(replayed[0].id, ev2.id);
    assert.equal(replayed[1].id, ev3.id);
  });

  await test('createTurnStream yields events asynchronously with abort support', async () => {
    eventBus.clear();
    const sid = 'sess_stream_test';
    const stream = createTurnStream({ sessionId: sid });

    setTimeout(() => {
      eventBus.emitEvent(sid, 't1', 'agent.thought', { text: 'step 1' });
      eventBus.emitEvent(sid, 't1', 'session.completed', { status: 'SUCCESS' });
    }, 10);

    const received: string[] = [];
    for await (const event of stream) {
      received.push(event.type);
      if (event.type === 'session.completed') break;
    }

    assert.deepEqual(received, ['agent.thought', 'session.completed']);
  });

  // --------------------------------------------------------------------------
  // Group 3: Cryptographic HITL Approval Gate
  // --------------------------------------------------------------------------
  console.log('\nGroup 3: Cryptographic HITL Approval Gate');

  await test('HitlGate generates and verifies cryptographic HMAC tokens', () => {
    hitlGate.clear();
    const sid = 'sess_crypto_test';
    const expiresAt = Date.now() + 60000;
    const token = hitlGate.generateResumeToken(sid, 'call_01', expiresAt);

    assert.ok(token.startsWith('tok_sec_'));
    assert.equal(hitlGate.verifyTokenSignature(sid, 'call_01', token), true);
    assert.equal(hitlGate.verifyTokenSignature(sid, 'call_wrong', token), false);
    assert.equal(hitlGate.verifyTokenSignature('wrong_sid', 'call_01', token), false);
  });

  await test('HitlGate rejects expired tokens', () => {
    hitlGate.clear();
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;

    // Create approval with negative TTL so it expires immediately
    const req = hitlGate.createApprovalRequest(
      sid,
      'thread_orch',
      'turn_1',
      'call_pr_exp',
      'github_mcp_create_pull_request',
      {},
      { ttlMs: -1000 }
    );

    const validation = hitlGate.validateResumeToken(sid, req.resumeToken);
    assert.equal(validation.valid, false);
    assert.ok(validation.error?.includes('expired'));
  });

  await test('HitlGate pauses turn on createApprovalRequest and transitions state', () => {
    hitlGate.clear();
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;

    const req = hitlGate.createApprovalRequest(
      sid,
      'thread_orch',
      'turn_1',
      'call_pr_1',
      'github_mcp_create_pull_request',
      { branch: 'openheal/fix' },
      { proposedPatch: '--- a/file\n+++ b/file' }
    );

    assert.ok(hitlGate.isPendingApproval(sid));
    const currentSession = sessionManager.getRequiredSession(sid);
    assert.equal(currentSession.status, 'AWAITING_HUMAN_APPROVAL');
    assert.equal(currentSession.hitlApproval?.status, 'pending');
    assert.equal(currentSession.hitlApproval?.resumeToken, req.resumeToken);
  });

  await test('HitlGate resolves approval with allow and updates session to EXECUTING_PR', () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;

    const req = hitlGate.createApprovalRequest(
      sid,
      'thread_orch',
      'turn_1',
      'call_pr_2',
      'github_mcp_create_pull_request',
      { branch: 'openheal/fix' }
    );

    const res = hitlGate.resolveApproval({
      sessionId: sid,
      resumeToken: req.resumeToken,
      decision: {
        status: 'allow',
        approver: 'lead_dev@company.com',
        modifiedParameters: { branch: 'openheal/fix-custom' },
      },
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'allow');
    assert.equal(hitlGate.isPendingApproval(sid), false);

    const updated = sessionManager.getRequiredSession(sid);
    assert.equal(updated.status, 'EXECUTING_PR');
    assert.equal(updated.hitlApproval?.status, 'allowed');
    assert.equal(updated.hitlApproval?.decision?.approver, 'lead_dev@company.com');
  });

  await test('HitlGate resolves approval with deny and transitions session to REJECTED', () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;

    const req = hitlGate.createApprovalRequest(
      sid,
      'thread_orch',
      'turn_1',
      'call_pr_deny',
      'github_mcp_create_pull_request',
      {}
    );

    const res = hitlGate.resolveApproval({
      sessionId: sid,
      resumeToken: req.resumeToken,
      decision: {
        status: 'deny',
        reason: 'Requested refactoring not acceptable',
      },
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'deny');

    const updated = sessionManager.getRequiredSession(sid);
    assert.equal(updated.status, 'REJECTED');
    assert.equal(updated.hitlApproval?.status, 'denied');
  });

  await test('HitlGate enforces idempotency and rejects token reuse', () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;

    const req = hitlGate.createApprovalRequest(
      sid,
      'thread_orch',
      'turn_1',
      'call_pr_3',
      'github_mcp_create_pull_request',
      {}
    );

    const first = hitlGate.resolveApproval({
      sessionId: sid,
      resumeToken: req.resumeToken,
      decision: { status: 'allow' },
    });
    assert.equal(first.success, true);

    const second = hitlGate.resolveApproval({
      sessionId: sid,
      resumeToken: req.resumeToken,
      decision: { status: 'allow' },
    });
    assert.equal(second.success, false);
    assert.ok(second.error?.includes('idempotency'));
  });

  // --------------------------------------------------------------------------
  // Group 4: Diagnostic Subagent (Multi-Language AST Localization)
  // --------------------------------------------------------------------------
  console.log('\nGroup 4: Diagnostic Subagent (Multi-Language AST Localization)');

  await test('DiagnosticSubagent parses pytest traceback and localizes Python AST node', async () => {
    const pytestLog = `
============================= test session starts ==============================
FAILED tests/test_calc.py::test_division - ZeroDivisionError: division by zero
Traceback (most recent call last):
  File "/workspace/tests/test_calc.py", line 8, in test_division
    assert divide(10, 0) == 0
  File "/workspace/src/calc.py", line 14, in divide
    return a / b
ZeroDivisionError: division by zero
============================== 1 failed in 0.12s ===============================
`;

    const repoFiles = {
      'src/calc.py': `
class Calculator:
    def add(self, a, b):
        return a + b

def divide(a, b):
    return a / b
`,
    };

    const report = await diagnosticSubagent.diagnose(
      'sess_diag_1',
      'thread_diag_1',
      pytestLog,
      repoFiles
    );

    assert.equal(report.frameworkDetected, 'pytest');
    assert.equal(report.failureType, 'ZeroDivisionError');
    assert.equal(report.primaryRootCauseLocation.filePath, '/workspace/src/calc.py');
    assert.equal(report.primaryRootCauseLocation.startLine, 14);
    assert.equal(report.primaryRootCauseLocation.symbolName, 'divide');
    assert.equal(report.primaryRootCauseLocation.nodeType, 'FunctionDeclaration');
    assert.ok(report.hypotheses[0].confidenceScore >= 0.85);
  });

  await test('DiagnosticSubagent parses Jest / TypeScript error and localizes AST node', async () => {
    const jestLog = `
FAIL src/cache.test.ts
  ● CacheService > should retrieve cached value

    TypeError: Cannot read properties of undefined (reading 'get')

      18 | export function fetchFromCache(cache: any, key: string) {
    > 19 |   return cache.get(key);
         |                ^
      20 | }

      at fetchFromCache (src/cache.ts:19:16)
      at Object.<anonymous> (src/cache.test.ts:8:12)
`;

    const repoFiles = {
      'src/cache.ts': `
export function fetchFromCache(cache: any, key: string) {
  return cache.get(key);
}
`,
    };

    const report = await diagnosticSubagent.diagnose(
      'sess_diag_2',
      'thread_diag_2',
      jestLog,
      repoFiles
    );

    assert.equal(report.frameworkDetected, 'jest');
    assert.equal(report.failureType, 'TypeError');
    assert.equal(report.primaryRootCauseLocation.symbolName, 'fetchFromCache');
    assert.ok(report.primaryRootCauseLocation.codeSnippet.includes('fetchFromCache'));
  });

  await test('DiagnosticSubagent parses Rust cargo test failure', async () => {
    const cargoLog = `
running 1 test
test tests::test_parse ... FAILED

failures:

---- tests::test_parse stdout ----
thread 'tests::test_parse' panicked at 'index out of bounds: the len is 3 but the index is 5', src/parser.rs:42:15

failures:
    tests::test_parse

test result: FAILED. 0 passed; 1 failed; 0 ignored
`;

    const repoFiles = {
      'src/parser.rs': `
pub fn parse_tokens(tokens: &[&str]) -> &str {
    tokens[5]
}
`,
    };

    const report = await diagnosticSubagent.diagnose(
      'sess_diag_3',
      'thread_diag_3',
      cargoLog,
      repoFiles
    );

    assert.equal(report.frameworkDetected, 'cargo');
    assert.equal(report.failureType, 'RustPanic');
    assert.equal(report.primaryRootCauseLocation.filePath, 'src/parser.rs');
    assert.equal(report.primaryRootCauseLocation.startLine, 42);
    assert.equal(report.primaryRootCauseLocation.symbolName, 'parse_tokens');
  });

  await test('DiagnosticSubagent parses Go test failure', async () => {
    const goLog = `
=== RUN   TestCalculator
--- FAIL: TestCalculator (0.00s)
    calc_test.go:42: division by zero encountered
FAIL
FAIL	github.com/org/calc	0.005s
`;

    const repoFiles = {
      'calc_test.go': `
package calc

func TestCalculator(t *testing.T) {
    Divide(10, 0)
}
`,
    };

    const report = await diagnosticSubagent.diagnose(
      'sess_diag_4',
      'thread_diag_4',
      goLog,
      repoFiles
    );

    assert.equal(report.frameworkDetected, 'gotest');
    assert.equal(report.failingTests[0], 'TestCalculator');
  });

  await test('DiagnosticSubagent handles unparsed generic logs with fallback', async () => {
    const genericLog = `
[Build Error] Fatal runtime error: src/main.cpp:55: null pointer dereference
`;

    const report = await diagnosticSubagent.diagnose(
      'sess_diag_5',
      'thread_diag_5',
      genericLog,
      {}
    );

    assert.equal(report.frameworkDetected, 'generic');
    assert.equal(report.primaryRootCauseLocation.filePath, 'src/main.cpp');
    assert.equal(report.primaryRootCauseLocation.startLine, 55);
  });

  // --------------------------------------------------------------------------
  // Group 5: Patch Synthesizer & Unified Diff Builder
  // --------------------------------------------------------------------------
  console.log('\nGroup 5: Patch Synthesizer & Unified Diff Builder');

  await test('PatchSynthesizer builds standard unified diff format', () => {
    const original = `def divide(a, b):\n    return a / b\n`;
    const patched = `def divide(a, b):\n    if b == 0:\n        raise ValueError("Cannot divide by zero")\n    return a / b\n`;

    const diff = patchSynthesizerSubagent.generateUnifiedDiff('src/calc.py', original, patched);
    assert.ok(diff.startsWith('--- a/src/calc.py'));
    assert.ok(diff.includes('+++ b/src/calc.py'));
    assert.ok(diff.includes('@@ -1,'));
    assert.ok(diff.includes('+    if b == 0:'));

    const stats = patchSynthesizerSubagent.calculateDiffStats(diff);
    assert.equal(stats.added, 2);
    assert.equal(stats.removed, 0);
  });

  await test('PatchSynthesizer sanitizes markdown fences from model output', () => {
    const fenced = '```python\ndef divide(a, b):\n    return a / b\n```';
    const sanitized = patchSynthesizerSubagent.sanitizePatchOutput(fenced);
    assert.equal(sanitized, 'def divide(a, b):\n    return a / b');
  });

  await test('PatchSynthesizer validates AST syntax and detects unclosed delimiters', () => {
    const validPy = `def add(a, b):\n    return (a + b)\n`;
    const invalidPy = `def add(a, b):\n    return (a + b\n`;

    const validCheck = patchSynthesizerSubagent.validateSyntax('src/calc.py', validPy);
    assert.equal(validCheck.valid, true);

    const invalidCheck = patchSynthesizerSubagent.validateSyntax('src/calc.py', invalidPy);
    assert.equal(invalidCheck.valid, false);
    assert.ok(invalidCheck.errors[0].includes('Unclosed'));
  });

  await test('PatchSynthesizer enforces Anti-Scope-Creep policy', () => {
    const patches = [
      {
        filePath: 'src/calc.py',
        originalContent: 'a',
        patchedContent: 'b',
        diff: '--- a\n+++ b\n+1\n+2',
        linesAdded: 2,
        linesRemoved: 0,
        astValid: true,
        syntaxErrors: [],
      },
    ];

    const allowedAssessment = patchSynthesizerSubagent.assessScopeCreep(
      patches,
      new Set(['src/calc.py'])
    );
    assert.equal(allowedAssessment.passed, true);
    assert.equal(allowedAssessment.riskScore <= 40, true);

    // Violating patch touching unrelated file
    const creepAssessment = patchSynthesizerSubagent.assessScopeCreep(
      patches,
      new Set(['src/other.py'])
    );
    assert.equal(creepAssessment.passed, false);
    assert.ok(creepAssessment.riskScore >= 45);
    assert.deepEqual(creepAssessment.unrelatedFilesTouched, ['src/calc.py']);
  });

  // --------------------------------------------------------------------------
  // Group 6: Regression Verifier & Delta Comparison
  // --------------------------------------------------------------------------
  console.log('\nGroup 6: Regression Verifier & Delta Comparison');

  await test('RegressionVerifier computes delta matrix correctly', () => {
    const previouslyFailing = ['test_division', 'test_modulo'];
    const currentFailing = ['test_modulo'];
    const currentPassing = ['test_division', 'test_addition'];

    const comparison = regressionVerifierSubagent.computeBaselineComparison(
      previouslyFailing,
      currentFailing,
      currentPassing
    );

    assert.deepEqual(comparison.previouslyFailingNowPassing, ['test_division']);
    assert.deepEqual(comparison.stillFailing, ['test_modulo']);
    assert.deepEqual(comparison.newRegressions, []);
  });

  await test('RegressionVerifier detects new regressions', () => {
    const previouslyFailing = ['test_division'];
    const currentFailing = ['test_division', 'test_multiplication']; // new regression!
    const currentPassing = ['test_addition'];

    const comparison = regressionVerifierSubagent.computeBaselineComparison(
      previouslyFailing,
      currentFailing,
      currentPassing
    );

    assert.deepEqual(comparison.newRegressions, ['test_multiplication']);
  });

  await test('RegressionVerifier orchestrates sandbox verification pass', async () => {
    const mockSandbox: ISandboxInstance = {
      id: 'ws_mock_1',
      language: 'python',
      executeCommand: async () => ({
        exitCode: 0,
        stdout: '3 passed in 0.15s',
        stderr: '',
        durationMs: 150,
      }),
      streamCommand: async (cmd, onStdout) => {
        onStdout('=== 3 passed in 0.15s ===\n');
        return {
          exitCode: 0,
          stdout: '=== 3 passed in 0.15s ===',
          stderr: '',
          durationMs: 150,
        };
      },
      uploadFile: async () => {},
      readFile: async () => '',
      destroy: async () => {},
    };

    const report = await regressionVerifierSubagent.verify({
      sessionId: 'sess_verif_test',
      threadId: 'thread_verif_test',
      sandbox: mockSandbox,
      testCommand: 'pytest',
      attemptNumber: 1,
      previouslyFailingTests: ['test_division'],
      enableFlakyGuard: false,
    });

    assert.equal(report.overallStatus, 'PASSED');
    assert.equal(report.passedCount, 3);
    assert.equal(report.failedCount, 0);
    assert.deepEqual(report.baselineComparison.previouslyFailingNowPassing, ['test_division']);
  });

  // --------------------------------------------------------------------------
  // Group 7: TrueForge Harness End-to-End Workflow Loop
  // --------------------------------------------------------------------------
  console.log('\nGroup 7: TrueForge Harness End-to-End Workflow Loop');

  await test('TrueForgeHarness executes full self-healing turn loop with HITL pause & resume', async () => {
    const repoFiles = {
      'src/calc.py': `def divide(a, b):\n    return a / b\n`,
    };

    const baselineLog = `
FAILED tests/test_calc.py::test_divide - ZeroDivisionError: division by zero
  File "src/calc.py", line 2, in divide
    return a / b
ZeroDivisionError: division by zero
`;

    let fileContent = repoFiles['src/calc.py'];

    const mockSandbox: ISandboxInstance = {
      id: 'ws_e2e_1',
      language: 'python',
      executeCommand: async () => {
        const passes = fileContent.includes('if b == 0:');
        return {
          exitCode: passes ? 0 : 1,
          stdout: passes ? '1 passed in 0.05s' : '1 failed in 0.05s',
          stderr: '',
          durationMs: 50,
        };
      },
      streamCommand: async (cmd, onStdout) => {
        const passes = fileContent.includes('if b == 0:');
        const text = passes ? '1 passed in 0.05s\n' : '1 failed in 0.05s\n';
        onStdout(text);
        return {
          exitCode: passes ? 0 : 1,
          stdout: text,
          stderr: '',
          durationMs: 50,
        };
      },
      uploadFile: async (path, content) => {
        fileContent = content;
      },
      readFile: async () => fileContent,
      destroy: async () => {},
    };

    // 1. Start session
    const session = await harness.startSession({
      repoUrl: 'https://github.com/openheal/python-calculator',
      language: 'python',
    }, {
      sandbox: mockSandbox,
      repoFiles,
      baselineLog,
    });

    const sid = session.config.sessionId;

    // Execution loop runs and should pause at HITL approval gate
    await new Promise((r) => setTimeout(r, 1500));

    const pausedSession = sessionManager.getRequiredSession(sid);
    assert.equal(pausedSession.status, 'AWAITING_HUMAN_APPROVAL');
    assert.ok(pausedSession.hitlApproval);
    assert.equal(pausedSession.hitlApproval?.status, 'pending');

    const token = pausedSession.hitlApproval!.resumeToken;
    assert.ok(token.startsWith('tok_sec_'));

    // 2. Human reviews diff and clicks [Approve & Open PR]
    const resumeRes = await harness.resumeWithApproval(
      sid,
      token,
      {
        status: 'allow',
        approver: 'senior_qa@openheal.dev',
      },
      async ({ branch, title, body }) => {
        return {
          prNumber: 42,
          prUrl: `https://github.com/openheal/python-calculator/pull/42`,
          branchName: branch,
          title,
          body,
        };
      }
    );

    assert.equal(resumeRes.success, true);
    assert.equal(resumeRes.sessionState.status, 'COMPLETED');
    assert.equal(resumeRes.sessionState.pullRequest?.prNumber, 42);
    assert.equal(resumeRes.sessionState.pullRequest?.prUrl, 'https://github.com/openheal/python-calculator/pull/42');
  });

  await test('TrueForgeHarness handles HITL rejection correctly', async () => {
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/org/repo' });
    const sid = session.config.sessionId;
    const req = hitlGate.createApprovalRequest(
      sid,
      't_orch',
      'turn_1',
      'call_pr_rej',
      'github_mcp_create_pull_request',
      {}
    );

    const res = await harness.resumeWithApproval(sid, req.resumeToken, {
      status: 'deny',
      reason: 'Patch does not meet coding guidelines',
    });

    assert.equal(res.success, true);
    assert.equal(res.sessionState.status, 'REJECTED');
    assert.equal(res.sessionState.errorMessage, 'Patch does not meet coding guidelines');
  });

  console.log('\n======================================================');
  console.log(`Summary: ${passedTests}/${totalTests} tests passed successfully!`);
  console.log('======================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
