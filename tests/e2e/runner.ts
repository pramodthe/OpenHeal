#!/usr/bin/env node
/**
 * OpenHeal Standalone E2E Test Runner & Assertion Engine
 * Zero external dependencies, pure TypeScript/Node.js.
 * Supports: Tiers 1-4, colored ANSI reporting, structured summary tables, CLI filters.
 */

// ---------------------------------------------------------------------------
// ANSI Color Constants & Formatter
// ---------------------------------------------------------------------------
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

// ---------------------------------------------------------------------------
// Test Registry & Context Types
// ---------------------------------------------------------------------------

export type TestFn = () => void | Promise<void>;
export type HookFn = () => void | Promise<void>;

export interface TestCase {
  id: string;
  name: string;
  fn: TestFn;
  suitePath: string[];
  tier?: string;
  feature?: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: Error | unknown;
  timeoutMs?: number;
}

export interface TestSuite {
  name: string;
  parent?: TestSuite;
  suites: TestSuite[];
  tests: TestCase[];
  beforeAllHooks: HookFn[];
  afterAllHooks: HookFn[];
  beforeEachHooks: HookFn[];
  afterEachHooks: HookFn[];
}

export interface RunnerOptions {
  tierFilter?: string;
  featureFilter?: string;
  grepFilter?: string;
  verbose?: boolean;
  quiet?: boolean;
  bail?: boolean;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Global Test Harness State
// ---------------------------------------------------------------------------

export class TestHarness {
  private rootSuite: TestSuite;
  private currentSuite: TestSuite;
  private allTests: TestCase[];
  private options: RunnerOptions;

  constructor() {
    this.rootSuite = {
      name: 'ROOT',
      suites: [],
      tests: [],
      beforeAllHooks: [],
      afterAllHooks: [],
      beforeEachHooks: [],
      afterEachHooks: [],
    };
    this.currentSuite = this.rootSuite;
    this.allTests = [];
    this.options = {};
    this.parseCliArgs();
  }

  public setOptions(opts: Partial<RunnerOptions>) {
    this.options = { ...this.options, ...opts };
  }

  public getOptions(): RunnerOptions {
    return this.options;
  }

  private parseCliArgs() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--tier=')) {
        this.options.tierFilter = arg.split('=')[1];
      } else if (arg === '--tier' && i + 1 < args.length) {
        this.options.tierFilter = args[++i];
      } else if (arg.startsWith('--feature=')) {
        this.options.featureFilter = arg.split('=')[1];
      } else if (arg === '--feature' && i + 1 < args.length) {
        this.options.featureFilter = args[++i];
      } else if (arg.startsWith('--grep=')) {
        this.options.grepFilter = arg.split('=')[1];
      } else if (arg === '--grep' && i + 1 < args.length) {
        this.options.grepFilter = args[++i];
      } else if (arg === '--verbose' || arg === '-v') {
        this.options.verbose = true;
      } else if (arg === '--quiet' || arg === '-q') {
        this.options.quiet = true;
      } else if (arg === '--bail' || arg === '-b') {
        this.options.bail = true;
      }
    }
  }

  public describe(name: string, fn: () => void) {
    const suite: TestSuite = {
      name,
      parent: this.currentSuite,
      suites: [],
      tests: [],
      beforeAllHooks: [],
      afterAllHooks: [],
      beforeEachHooks: [],
      afterEachHooks: [],
    };
    this.currentSuite.suites.push(suite);
    const prev = this.currentSuite;
    this.currentSuite = suite;
    try {
      fn();
    } finally {
      this.currentSuite = prev;
    }
  }

  public test(name: string, fn: TestFn, timeoutMs = 15000) {
    const suitePath = this.getSuitePath(this.currentSuite);
    const fullPath = [...suitePath, name].join(' > ');
    
    // Auto-detect tier and feature tags
    let tier: string | undefined;
    const tierMatch = fullPath.match(/Tier\s*([1-5])/i);
    if (tierMatch) tier = `Tier ${tierMatch[1]}`;

    let feature: string | undefined;
    const featMatch = fullPath.match(/F(0[1-9]|1[0-9]|2[0-3])/i);
    if (featMatch) feature = featMatch[0].toUpperCase();

    const tc: TestCase = {
      id: `test_${this.allTests.length + 1}`,
      name,
      fn,
      suitePath,
      tier,
      feature,
      status: 'pending',
      durationMs: 0,
      timeoutMs,
    };

    this.currentSuite.tests.push(tc);
    this.allTests.push(tc);
  }

  public beforeAll(fn: HookFn) {
    this.currentSuite.beforeAllHooks.push(fn);
  }

  public afterAll(fn: HookFn) {
    this.currentSuite.afterAllHooks.push(fn);
  }

  public beforeEach(fn: HookFn) {
    this.currentSuite.beforeEachHooks.push(fn);
  }

  public afterEach(fn: HookFn) {
    this.currentSuite.afterEachHooks.push(fn);
  }

  private getSuitePath(suite: TestSuite): string[] {
    const path: string[] = [];
    let cur: TestSuite | undefined = suite;
    while (cur && cur.name !== 'ROOT') {
      path.unshift(cur.name);
      cur = cur.parent;
    }
    return path;
  }

  private getAllBeforeEach(suite: TestSuite): HookFn[] {
    const hooks: HookFn[] = [];
    let cur: TestSuite | undefined = suite;
    while (cur) {
      hooks.unshift(...cur.beforeEachHooks);
      cur = cur.parent;
    }
    return hooks;
  }

  private getAllAfterEach(suite: TestSuite): HookFn[] {
    const hooks: HookFn[] = [];
    let cur: TestSuite | undefined = suite;
    while (cur) {
      hooks.push(...cur.afterEachHooks);
      cur = cur.parent;
    }
    return hooks;
  }

  public shouldRunTest(test: TestCase): boolean {
    const fullPath = [...test.suitePath, test.name].join(' > ');
    if (this.options.tierFilter) {
      const target = this.options.tierFilter.toLowerCase().replace('tier', '').trim();
      const current = (test.tier || '').toLowerCase().replace('tier', '').trim();
      if (!current.includes(target)) return false;
    }
    if (this.options.featureFilter) {
      const target = this.options.featureFilter.toUpperCase();
      if (!test.feature || !test.feature.includes(target)) {
        if (!fullPath.toUpperCase().includes(target)) return false;
      }
    }
    if (this.options.grepFilter) {
      const re = new RegExp(this.options.grepFilter, 'i');
      if (!re.test(fullPath)) return false;
    }
    return true;
  }

  public async runSuite(suite: TestSuite, depth = 0): Promise<void> {
    if (suite.name !== 'ROOT') {
      const indent = '  '.repeat(depth);
      console.log(`${indent}${colors.bold}${colors.cyan}${suite.name}${colors.reset}`);
    }

    // Run beforeAll hooks
    for (const hook of suite.beforeAllHooks) {
      await hook();
    }

    // Run tests in current suite
    for (const tc of suite.tests) {
      const indent = '  '.repeat(depth + 1);
      if (!this.shouldRunTest(tc)) {
        tc.status = 'skipped';
        if (this.options.verbose) {
          console.log(`${indent}${colors.yellow}○ [SKIP]${colors.reset} ${colors.dim}${tc.name}${colors.reset}`);
        }
        continue;
      }

      const beforeEachHooks = this.getAllBeforeEach(suite);
      const afterEachHooks = this.getAllAfterEach(suite);

      const start = Date.now();
      try {
        for (const hook of beforeEachHooks) {
          await hook();
        }

        // Run test with timeout
        await Promise.race([
          Promise.resolve(tc.fn()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Test timed out after ${tc.timeoutMs}ms`)), tc.timeoutMs)
          ),
        ]);

        tc.status = 'passed';
        tc.durationMs = Date.now() - start;
        console.log(
          `${indent}${colors.green}✔ PASS${colors.reset} ${tc.name} ${colors.gray}(${tc.durationMs}ms)${colors.reset}`
        );
      } catch (err) {
        tc.status = 'failed';
        tc.durationMs = Date.now() - start;
        tc.error = err;
        console.log(
          `${indent}${colors.red}✖ FAIL${colors.reset} ${colors.bold}${tc.name}${colors.reset} ${colors.gray}(${tc.durationMs}ms)${colors.reset}`
        );
        if (err instanceof Error) {
          const errLines = (err.stack || err.message)
            .split('\n')
            .map((line) => `${indent}  ${colors.red}${line}${colors.reset}`)
            .join('\n');
          console.log(errLines);
        } else {
          console.log(`${indent}  ${colors.red}${String(err)}${colors.reset}`);
        }

        if (this.options.bail) {
          console.log(`${colors.red}${colors.bold}Bailing early due to failure.--bail flag set.${colors.reset}`);
          return;
        }
      } finally {
        for (const hook of afterEachHooks) {
          try {
            await hook();
          } catch (e) {
            console.error(`${indent}Error in afterEach hook:`, e);
          }
        }
      }
    }

    // Run nested suites
    for (const child of suite.suites) {
      await this.runSuite(child, suite.name === 'ROOT' ? depth : depth + 1);
    }

    // Run afterAll hooks
    for (const hook of suite.afterAllHooks) {
      try {
        await hook();
      } catch (e) {
        console.error('Error in afterAll hook:', e);
      }
    }
  }

  public async run(): Promise<{ total: number; passed: number; failed: number; skipped: number; durationMs: number }> {
    const startTime = Date.now();
    console.log(`\n${colors.bold}${colors.blue}══════════════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}             🚀 OPENHEAL E2E TEST RUNNER & VERIFICATION HARNESS              ${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}══════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

    if (this.options.tierFilter) console.log(`${colors.cyan}  • Filter Tier: ${this.options.tierFilter}${colors.reset}`);
    if (this.options.featureFilter) console.log(`${colors.cyan}  • Filter Feature: ${this.options.featureFilter}${colors.reset}`);
    if (this.options.grepFilter) console.log(`${colors.cyan}  • Filter Grep: ${this.options.grepFilter}${colors.reset}`);
    console.log('');

    await this.runSuite(this.rootSuite);

    const totalDuration = Date.now() - startTime;
    const passed = this.allTests.filter((t) => t.status === 'passed').length;
    const failed = this.allTests.filter((t) => t.status === 'failed').length;
    const skipped = this.allTests.filter((t) => t.status === 'skipped').length;
    const total = this.allTests.length;

    this.printSummaryTable(passed, failed, skipped, total, totalDuration);

    return { total, passed, failed, skipped, durationMs: totalDuration };
  }

  private printSummaryTable(passed: number, failed: number, skipped: number, total: number, durationMs: number) {
    console.log(`\n${colors.bold}${colors.blue}──────────────────────────────────────────────────────────────────────────────${colors.reset}`);
    console.log(`${colors.bold}                        📊 TEST EXECUTION SUMMARY                            ${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}──────────────────────────────────────────────────────────────────────────────${colors.reset}`);

    // Aggregate by Tier
    const tiers = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Other'];
    console.log(`${colors.bold}${'Category'.padEnd(20)} | ${'Passed'.padStart(8)} | ${'Failed'.padStart(8)} | ${'Skipped'.padStart(8)} | ${'Total'.padStart(8)}${colors.reset}`);
    console.log(`${'-'.repeat(20)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}`);

    for (const tier of tiers) {
      const tierTests = this.allTests.filter((t) => (t.tier === tier) || (tier === 'Other' && !t.tier));
      if (tierTests.length === 0) continue;
      const tPassed = tierTests.filter((t) => t.status === 'passed').length;
      const tFailed = tierTests.filter((t) => t.status === 'failed').length;
      const tSkipped = tierTests.filter((t) => t.status === 'skipped').length;
      const tTotal = tierTests.length;

      const pColor = tPassed > 0 ? colors.green : colors.gray;
      const fColor = tFailed > 0 ? colors.red : colors.gray;

      console.log(
        `${colors.bold}${tier.padEnd(20)}${colors.reset} | ` +
        `${pColor}${String(tPassed).padStart(8)}${colors.reset} | ` +
        `${fColor}${String(tFailed).padStart(8)}${colors.reset} | ` +
        `${colors.yellow}${String(tSkipped).padStart(8)}${colors.reset} | ` +
        `${String(tTotal).padStart(8)}`
      );
    }

    console.log(`${'-'.repeat(20)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}`);
    console.log(
      `${colors.bold}${'TOTAL'.padEnd(20)}${colors.reset} | ` +
      `${colors.green}${colors.bold}${String(passed).padStart(8)}${colors.reset} | ` +
      `${failed > 0 ? colors.red : colors.green}${colors.bold}${String(failed).padStart(8)}${colors.reset} | ` +
      `${colors.yellow}${String(skipped).padStart(8)}${colors.reset} | ` +
      `${colors.bold}${String(total).padStart(8)}${colors.reset}`
    );
    console.log(`${colors.bold}${colors.blue}──────────────────────────────────────────────────────────────────────────────${colors.reset}`);
    console.log(`${colors.cyan}  Total Duration: ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)${colors.reset}`);

    if (failed === 0 && total > 0 && passed > 0) {
      console.log(`\n${colors.bgGreen}${colors.bold}${colors.black}  🎉 ALL TESTS PASSED SUCCESSFULLY (100% PASS RATE)  ${colors.reset}\n`);
    } else if (failed > 0) {
      console.log(`\n${colors.bgRed}${colors.bold}${colors.white}  ❌ TEST SUITE FAILED: ${failed} OF ${total} TESTS FAILED  ${colors.reset}\n`);
    } else {
      console.log(`\n${colors.bgYellow}${colors.bold}${colors.black}  ⚠ NO TESTS EXECUTED OR ALL SKIPPED  ${colors.reset}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Global Singleton Instance & Exports
// ---------------------------------------------------------------------------

export const globalHarness = new TestHarness();

export const describe = (name: string, fn: () => void) => globalHarness.describe(name, fn);
export const test = (name: string, fn: TestFn, timeoutMs?: number) => globalHarness.test(name, fn, timeoutMs);
export const it = test;
export const beforeAll = (fn: HookFn) => globalHarness.beforeAll(fn);
export const afterAll = (fn: HookFn) => globalHarness.afterAll(fn);
export const beforeEach = (fn: HookFn) => globalHarness.beforeEach(fn);
export const afterEach = (fn: HookFn) => globalHarness.afterEach(fn);

// ---------------------------------------------------------------------------
// Rich Assertion Library (Expect & Assert)
// ---------------------------------------------------------------------------

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a.entries()) {
      if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    }
    return true;
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) {
      return false;
    }
  }
  return true;
}

export class AssertionError extends Error {
  public actual?: any;
  public expected?: any;

  constructor(message: string, actual?: any, expected?: any) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

export function assert(condition: boolean, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export const assertStrictEqual = (actual: any, expected: any, message?: string) => {
  if (actual !== expected) {
    throw new AssertionError(
      message || `Expected ${JSON.stringify(actual)} to strictly equal ${JSON.stringify(expected)}`,
      actual,
      expected
    );
  }
};

export const assertDeepStrictEqual = (actual: any, expected: any, message?: string) => {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(
      message || `Expected deep equality:\nActual:   ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(expected)}`,
      actual,
      expected
    );
  }
};

export const assertThrows = (fn: () => any, expectedError?: RegExp | string | ((err: any) => boolean), message?: string) => {
  let threw = false;
  let caught: any;
  try {
    fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  if (!threw) {
    throw new AssertionError(message || 'Expected function to throw an error, but it did not.');
  }
  if (expectedError) {
    if (typeof expectedError === 'string') {
      const msg = caught instanceof Error ? caught.message : String(caught);
      if (!msg.includes(expectedError)) {
        throw new AssertionError(`Expected error message to contain "${expectedError}", got "${msg}"`);
      }
    } else if (expectedError instanceof RegExp) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      if (!expectedError.test(msg)) {
        throw new AssertionError(`Expected error to match ${expectedError}, got "${msg}"`);
      }
    } else if (typeof expectedError === 'function') {
      if (!expectedError(caught)) {
        throw new AssertionError('Custom error validation predicate failed on caught error.');
      }
    }
  }
};

export interface Matchers<T> {
  toBe(expected: T): void;
  toEqual(expected: any): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeCloseTo(expected: number, numDigits?: number): void;
  toContain(expected: any): void;
  toHaveLength(expected: number): void;
  toMatch(pattern: RegExp | string): void;
  toThrow(expected?: RegExp | string | Error): void;
  not: Matchers<T>;
}

export function expect<T = any>(actual: T): Matchers<T> {
  const createMatchers = (isNot: boolean): Matchers<T> => ({
    toBe(expected: T) {
      const match = actual === expected;
      if (isNot ? match : !match) {
        throw new AssertionError(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be ${JSON.stringify(expected)}`,
          actual,
          expected
        );
      }
    },
    toEqual(expected: any) {
      const match = deepEqual(actual, expected);
      if (isNot ? match : !match) {
        throw new AssertionError(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to deeply equal ${JSON.stringify(expected)}`,
          actual,
          expected
        );
      }
    },
    toBeTruthy() {
      const match = Boolean(actual);
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be truthy`, actual);
      }
    },
    toBeFalsy() {
      const match = !Boolean(actual);
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be falsy`, actual);
      }
    },
    toBeNull() {
      const match = actual === null;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be null`, actual);
      }
    },
    toBeUndefined() {
      const match = actual === undefined;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be undefined`, actual);
      }
    },
    toBeDefined() {
      const match = actual !== undefined;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected value ${isNot ? 'NOT ' : ''}to be defined, got undefined`);
      }
    },
    toBeGreaterThan(expected: number) {
      const match = typeof actual === 'number' && actual > expected;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${actual} ${isNot ? 'NOT ' : ''}to be > ${expected}`, actual, expected);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      const match = typeof actual === 'number' && actual >= expected;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${actual} ${isNot ? 'NOT ' : ''}to be >= ${expected}`, actual, expected);
      }
    },
    toBeLessThan(expected: number) {
      const match = typeof actual === 'number' && actual < expected;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${actual} ${isNot ? 'NOT ' : ''}to be < ${expected}`, actual, expected);
      }
    },
    toBeLessThanOrEqual(expected: number) {
      const match = typeof actual === 'number' && actual <= expected;
      if (isNot ? match : !match) {
        throw new AssertionError(`Expected ${actual} ${isNot ? 'NOT ' : ''}to be <= ${expected}`, actual, expected);
      }
    },
    toBeCloseTo(expected: number, numDigits = 2) {
      const diff = Math.abs((actual as any) - expected);
      const tolerance = Math.pow(10, -numDigits) / 2;
      const match = diff < tolerance;
      if (isNot ? match : !match) {
        throw new AssertionError(
          `Expected ${actual} ${isNot ? 'NOT ' : ''}to be close to ${expected} within precision ${numDigits} (diff: ${diff})`,
          actual,
          expected
        );
      }
    },
    toContain(expected: any) {
      let match = false;
      if (typeof actual === 'string') {
        match = actual.includes(String(expected));
      } else if (Array.isArray(actual)) {
        match = actual.some((item) => deepEqual(item, expected) || item === expected);
      } else if (actual instanceof Set || actual instanceof Map) {
        match = actual.has(expected);
      }
      if (isNot ? match : !match) {
        throw new AssertionError(
          `Expected collection ${isNot ? 'NOT ' : ''}to contain ${JSON.stringify(expected)}`,
          actual,
          expected
        );
      }
    },
    toHaveLength(expected: number) {
      const len = (actual as any)?.length;
      const match = len === expected;
      if (isNot ? match : !match) {
        throw new AssertionError(
          `Expected length ${isNot ? 'NOT ' : ''}to be ${expected}, got ${len}`,
          len,
          expected
        );
      }
    },
    toMatch(pattern: RegExp | string) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      const match = typeof actual === 'string' && regex.test(actual);
      if (isNot ? match : !match) {
        throw new AssertionError(
          `Expected string ${isNot ? 'NOT ' : ''}to match ${regex}, got "${actual}"`,
          actual,
          pattern
        );
      }
    },
    toThrow(expected?: RegExp | string | Error) {
      let threw = false;
      let error: any;
      if (typeof actual !== 'function') {
        throw new AssertionError(`Expected a function to test for throws, received ${typeof actual}`);
      }
      try {
        (actual as any)();
      } catch (e) {
        threw = true;
        error = e;
      }
      if (!isNot && !threw) {
        throw new AssertionError('Expected function to throw an error, but it did not.');
      }
      if (isNot && threw) {
        throw new AssertionError(`Expected function NOT to throw, but it threw: ${error}`);
      }
      if (expected && !isNot) {
        const msg = error instanceof Error ? error.message : String(error);
        if (typeof expected === 'string' && !msg.includes(expected)) {
          throw new AssertionError(`Expected error message to contain "${expected}", got "${msg}"`);
        } else if (expected instanceof RegExp && !expected.test(msg)) {
          throw new AssertionError(`Expected error message to match ${expected}, got "${msg}"`);
        }
      }
    },
    get not() {
      return createMatchers(!isNot);
    },
  });

  return createMatchers(false);
}

// ---------------------------------------------------------------------------
// Standalone Direct CLI Runner Entrypoint
// ---------------------------------------------------------------------------

export async function runAll() {
  // Dynamically import all test suites
  try {
    await import('./tier1_feature.test.ts');
  } catch (e) {
    try {
      await import('./tier1_feature.test.js');
    } catch (_) {}
  }

  try {
    await import('./tier2_boundary.test.ts');
  } catch (e) {
    try {
      await import('./tier2_boundary.test.js');
    } catch (_) {}
  }

  try {
    await import('./tier3_pairwise.test.ts');
  } catch (e) {
    try {
      await import('./tier3_pairwise.test.js');
    } catch (_) {}
  }

  try {
    await import('./tier4_workload.test.ts');
  } catch (e) {
    try {
      await import('./tier4_workload.test.js');
    } catch (_) {}
  }

  try {
    await import('../adversarial/adversarial_trueforge_swarm.test.ts');
  } catch (e) {
    try {
      await import('../adversarial/adversarial_trueforge_swarm.test.js');
    } catch (_) {}
  }

  const result = await globalHarness.run();
  if (result.failed > 0) {
    process.exit(1);
  }
}

// Self-execute if run as main script
const isMain = process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js');
if (isMain) {
  runAll().catch((err) => {
    console.error('Fatal Test Runner Exception:', err);
    process.exit(1);
  });
}
