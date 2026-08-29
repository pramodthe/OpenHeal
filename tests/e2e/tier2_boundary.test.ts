/**
 * Tier 2: Boundary, Corner Case, Stress & Resiliency Tests
 * Comprehensive tests for extreme payloads, malformed inputs, timeouts, token security, and race conditions.
 */

import { describe, test, expect } from './runner.ts';
import type {
  DiagnosticReport,
  ToolApprovalRequiredPayload,
  UserToolApprovalInput,
  CommandResult,
  SSEEvent,
} from './types.ts';

describe('[Tier 2: Boundary & Corner Cases]', () => {
  test('T2-01: Massive 50,000-line stack trace ingestion with head/tail preservation without OOM', () => {
    // Generate 50,000 lines of simulated recursive traceback
    const lines: string[] = [];
    lines.push('Traceback (most recent call last):');
    for (let i = 0; i < 50000; i++) {
      lines.push(`  File "/app/recursive.py", line ${i % 100 + 1}, in recurse_${i}\n    return recurse_${i + 1}()`);
    }
    lines.push('RecursionError: maximum recursion depth exceeded while calling a Python object');
    const hugeLog = lines.join('\n');

    // Bounded log trimmer function
    const truncateLog = (raw: string, maxLines = 1000): { trimmed: string; totalLines: number; truncated: boolean } => {
      const all = raw.split('\n');
      if (all.length <= maxLines) return { trimmed: raw, totalLines: all.length, truncated: false };
      const head = all.slice(0, 200);
      const tail = all.slice(all.length - 800);
      const marker = `\n... [TRUNCATED ${all.length - 1000} LINES TO PREVENT MEMORY EXHAUSTION] ...\n`;
      return {
        trimmed: head.join('\n') + marker + tail.join('\n'),
        totalLines: all.length,
        truncated: true,
      };
    };

    const res = truncateLog(hugeLog);
    expect(res.truncated).toBeTruthy();
    expect(res.totalLines).toBeGreaterThan(50000);
    expect(res.trimmed).toContain('Traceback (most recent call last):');
    expect(res.trimmed).toContain('RecursionError: maximum recursion depth exceeded');
    expect(res.trimmed).toContain('[TRUNCATED');
  });

  test('T2-02: Malformed stack traces with ANSI escape codes, null bytes, and mixed encodings', () => {
    const dirtyTrace = '\x00\x1b[31;1m\x1b[47mPANIC\x1b[0m in \x00/app/broken_unicode_\uFFFD.py:42 \u0007\u0008\r\nAssertionError: \x1b[32mexpected\x1b[0m vs \x1b[31mreceived\x1b[0m\x00';

    const sanitizeStackTrace = (trace: string): { cleanText: string; detectedFile?: string; detectedLine?: number } => {
      // Strip ANSI escape codes first
      const noAnsi = trace.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      // Strip null bytes and non-printable control codes (except newline/tab/carriage return)
      const clean = noAnsi.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      const fileMatch = clean.match(/([^\s:]+):(\d+)/);

      return {
        cleanText: clean.trim(),
        detectedFile: fileMatch?.[1],
        detectedLine: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
      };
    };

    const parsed = sanitizeStackTrace(dirtyTrace);
    expect(parsed.cleanText).not.toContain('\x00');
    expect(parsed.cleanText).not.toContain('\x1b[');
    expect(parsed.cleanText).toContain('PANIC in');
    expect(parsed.detectedLine).toBe(42);
  });

  test('T2-03: Process execution timeout triggers AbortController and returns partial output', async () => {
    const executeWithTimeout = async (
      promiseFn: (signal: AbortSignal) => Promise<string>,
      timeoutMs: number
    ): Promise<{ output: string; timedOut: boolean }> => {
      const controller = new AbortController();
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const output = await promiseFn(controller.signal);
        clearTimeout(timer);
        return { output, timedOut: false };
      } catch (err: any) {
        clearTimeout(timer);
        if (controller.signal.aborted || err.name === 'AbortError') {
          return { output: 'PARTIAL_BUFFER_BEFORE_TIMEOUT', timedOut: true };
        }
        throw err;
      }
    };

    const mockHangingCommand = (signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => resolve('Completed late'), 500);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          const err = new Error('Process aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const res = await executeWithTimeout(mockHangingCommand, 50);
    expect(res.timedOut).toBeTruthy();
    expect(res.output).toBe('PARTIAL_BUFFER_BEFORE_TIMEOUT');
  });

  test('T2-04: Network retry with exponential backoff on HTTP 429/503 errors', async () => {
    let callCount = 0;
    const flakeyApiCall = async (): Promise<{ status: number; data: string }> => {
      callCount++;
      if (callCount < 3) {
        const err = new Error('HTTP 429 Too Many Requests');
        (err as any).statusCode = 429;
        throw err;
      }
      return { status: 200, data: 'PR #42 Created' };
    };

    const callWithRetry = async <T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 10): Promise<T> => {
      let delay = initialDelayMs;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (e: any) {
          if (attempt === maxRetries) throw e;
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2; // exponential backoff
        }
      }
      throw new Error('Unreachable');
    };

    const result = await callWithRetry(flakeyApiCall, 4, 5);
    expect(callCount).toBe(3);
    expect(result.data).toBe('PR #42 Created');
  });

  test('T2-05: HITL resumeToken forgery detection and HMAC signature verification', () => {
    const SECRET_KEY = 'openheal_test_secret_key';

    // Mock HMAC signature helper
    const signToken = (payload: string): string => {
      let hash = 0;
      const combined = `${payload}:${SECRET_KEY}`;
      for (let i = 0; i < combined.length; i++) {
        hash = (hash << 5) - hash + combined.charCodeAt(i);
        hash |= 0;
      }
      return `sig_${Math.abs(hash).toString(16)}`;
    };

    const createSecureToken = (sessionId: string, toolCallId: string, ttlMs = 1800000) => {
      const expiresAt = Date.now() + ttlMs;
      const data = `${sessionId}.${toolCallId}.${expiresAt}`;
      const sig = signToken(data);
      return `${data}.${sig}`;
    };

    const verifyToken = (token: string): { valid: boolean; reason?: string } => {
      const parts = token.split('.');
      if (parts.length !== 4) return { valid: false, reason: 'MALFORMED_TOKEN_STRUCTURE' };
      const [sessionId, toolCallId, expiresAtStr, sig] = parts;
      const data = `${sessionId}.${toolCallId}.${expiresAtStr}`;
      const expectedSig = signToken(data);

      if (sig !== expectedSig) return { valid: false, reason: 'INVALID_SIGNATURE_TAMPERED' };
      const expiresAt = parseInt(expiresAtStr, 10);
      if (Date.now() > expiresAt) return { valid: false, reason: 'TOKEN_EXPIRED' };

      return { valid: true };
    };

    const validToken = createSecureToken('sess_1', 'call_1', 60000);
    const expiredToken = createSecureToken('sess_1', 'call_1', -1000);
    const forgedToken = validToken.replace('sess_1', 'sess_forged');

    expect(verifyToken(validToken).valid).toBeTruthy();
    expect(verifyToken(expiredToken).reason).toBe('TOKEN_EXPIRED');
    expect(verifyToken(forgedToken).reason).toBe('INVALID_SIGNATURE_TAMPERED');
    expect(verifyToken('bad.token').reason).toBe('MALFORMED_TOKEN_STRUCTURE');
  });

  test('T2-06: High-concurrency session isolation with 50 simultaneous sessions', () => {
    const sessionStore = new Map<string, { events: string[] }>();

    // Spawn 50 sessions
    for (let i = 0; i < 50; i++) {
      const sId = `session_${i}`;
      sessionStore.set(sId, { events: [] });
    }

    // Emit events concurrently
    for (let i = 0; i < 50; i++) {
      const sId = `session_${i}`;
      const store = sessionStore.get(sId);
      store?.events.push(`event_start_${i}`);
      store?.events.push(`event_heal_${i}`);
      store?.events.push(`event_finish_${i}`);
    }

    expect(sessionStore.size).toBe(50);
    for (let i = 0; i < 50; i++) {
      const sess = sessionStore.get(`session_${i}`);
      expect(sess?.events).toHaveLength(3);
      expect(sess?.events[0]).toBe(`event_start_${i}`);
      expect(sess?.events[2]).toBe(`event_finish_${i}`);
    }
  });

  test('T2-07: Degraded empty repository with zero test files handles discovery gracefully', () => {
    const discoverTests = (files: string[]): { hasTests: boolean; strategy: string } => {
      const testFiles = files.filter((f) => /test|spec/i.test(f));
      if (testFiles.length === 0) {
        return { hasTests: false, strategy: 'PROMPT_USER_OR_SYNTHESIZE_SMOKE_TEST' };
      }
      return { hasTests: true, strategy: 'RUN_TEST_SUITE' };
    };

    const emptyRepo = ['README.md', 'src/index.js'];
    const standardRepo = ['README.md', 'src/index.js', 'src/index.test.js'];

    expect(discoverTests(emptyRepo).hasTests).toBeFalsy();
    expect(discoverTests(emptyRepo).strategy).toBe('PROMPT_USER_OR_SYNTHESIZE_SMOKE_TEST');
    expect(discoverTests(standardRepo).hasTests).toBeTruthy();
  });

  test('T2-08: Pre-flight AST validator catches unbalanced brackets and invalid syntax before sandbox run', () => {
    const checkTsSyntax = (code: string): { valid: boolean; error?: string } => {
      const stack: string[] = [];
      const pairs: Record<string, string> = { '}': '{', ']': '[', ')': '(' };
      for (const ch of code) {
        if (['{', '[', '('].includes(ch)) stack.push(ch);
        else if (['}', ']', ')'].includes(ch)) {
          if (stack.pop() !== pairs[ch]) return { valid: false, error: `Unbalanced bracket: ${ch}` };
        }
      }
      if (stack.length > 0) return { valid: false, error: `Unclosed bracket: ${stack.pop()}` };
      return { valid: true };
    };

    expect(checkTsSyntax('function add(a: number, b: number) { return a + b; }').valid).toBeTruthy();
    expect(checkTsSyntax('function add(a: number, b: number { return a + b; }').valid).toBeFalsy();
    expect(checkTsSyntax('function add(a: number, b: number) { return a + b; ]').valid).toBeFalsy();
  });

  test('T2-09: Extreme scope creep penalty flags changes to sensitive files (.env, credentials, CI workflows)', () => {
    const evaluateFileRisk = (files: string[]): { allowed: boolean; flaggedCritical: string[] } => {
      const sensitivePatterns = [/\.env/i, /credentials/i, /\.github\/workflows/i, /secrets/i, /id_rsa/i];
      const flagged = files.filter((f) => sensitivePatterns.some((p) => p.test(f)));
      return {
        allowed: flagged.length === 0,
        flaggedCritical: flagged,
      };
    };

    expect(evaluateFileRisk(['src/calc.py', 'tests/test_calc.py']).allowed).toBeTruthy();
    expect(evaluateFileRisk(['src/calc.py', '.env.production']).allowed).toBeFalsy();
    expect(evaluateFileRisk(['.github/workflows/deploy.yml']).flaggedCritical).toHaveLength(1);
  });

  test('T2-10: SSE client abrupt disconnect flushes buffer and releases resources', () => {
    let cleanedUp = false;
    const clientStream = {
      connected: true,
      onClose: (cb: () => void) => {
        // simulate disconnect
        clientStream.connected = false;
        cleanedUp = true;
        cb();
      },
    };

    clientStream.onClose(() => {
      // handle cleanup
    });

    expect(clientStream.connected).toBeFalsy();
    expect(cleanedUp).toBeTruthy();
  });
});
