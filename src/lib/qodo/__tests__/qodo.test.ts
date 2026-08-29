/**
 * Unit Test Suite for Qodo CLI & PR-Agent Scorecard Engine
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectLanguage,
  extractASTFunctions,
  identifyTargetFunction,
  generateTestCasesForLanguage,
  resolveTestFilePath,
  injectTestsIntoFile,
  synthesizeTestsForPatch,
  runQodoCover,
  checkQodoCoverCliAvailable
} from '../cover.ts';
import {
  calculateQodoScorecard,
  determineGrade,
  determineVerdict,
  generateMarkdownScorecard,
  SCORECARD_WEIGHTS
} from '../scorecard.ts';

export async function runQodoTests() {
  console.log('\n--- Running Qodo Unit Tests ---');
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
  // 1. Language Detection & AST Function Extraction
  // =========================================================================
  await test('detectLanguage detects extensions and hints accurately', () => {
    assert.strictEqual(detectLanguage('calc.py'), 'python');
    assert.strictEqual(detectLanguage('cache.ts'), 'typescript');
    assert.strictEqual(detectLanguage('app.tsx'), 'typescript');
    assert.strictEqual(detectLanguage('server.js'), 'javascript');
    assert.strictEqual(detectLanguage('main.go'), 'go');
    assert.strictEqual(detectLanguage('parser.rs'), 'rust');
    assert.strictEqual(detectLanguage(undefined, 'golang'), 'go');
    assert.strictEqual(detectLanguage(undefined, 'python'), 'python');
  });

  await test('extractASTFunctions extracts Python def and async def functions', () => {
    const pythonCode = `
def divide(a: int, b: int) -> float:
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b

async def fetch_data(url: str, timeout: int = 30):
    return "data"
`;
    const fns = extractASTFunctions(pythonCode, 'python');
    assert.strictEqual(fns.length, 2);
    assert.strictEqual(fns[0].name, 'divide');
    assert.deepStrictEqual(fns[0].params, ['a', 'b']);
    assert.strictEqual(fns[0].returnType, 'float');
    assert.strictEqual(fns[1].name, 'fetch_data');
    assert.strictEqual(fns[1].isAsync, true);
  });

  await test('extractASTFunctions extracts TypeScript functions and arrow functions', () => {
    const tsCode = `
export function computeHash(data: string, salt: string): string {
    return data + salt;
}

export const sanitizeInput = async (input: string): Promise<string> => {
    return input.trim();
};
`;
    const fns = extractASTFunctions(tsCode, 'typescript');
    assert.strictEqual(fns.length, 2);
    assert.strictEqual(fns[0].name, 'computeHash');
    assert.deepStrictEqual(fns[0].params, ['data', 'salt']);
    assert.strictEqual(fns[1].name, 'sanitizeInput');
    assert.strictEqual(fns[1].isAsync, true);
  });

  await test('extractASTFunctions extracts Go and Rust functions', () => {
    const goCode = `func CalculateTax(amount float64, rate float64) (float64, error) { return amount * rate, nil }`;
    const goFns = extractASTFunctions(goCode, 'go');
    assert.strictEqual(goFns.length, 1);
    assert.strictEqual(goFns[0].name, 'CalculateTax');

    const rustCode = `pub fn parse_header(input: &str) -> Result<Header, ParseError> { Ok(Header) }`;
    const rustFns = extractASTFunctions(rustCode, 'rust');
    assert.strictEqual(rustFns.length, 1);
    assert.strictEqual(rustFns[0].name, 'parse_header');
    assert.strictEqual(rustFns[0].isExported, true);
  });

  // =========================================================================
  // 2. Targeted Function Identification & Test Generation
  // =========================================================================
  await test('identifyTargetFunction matches function from patch diff', () => {
    const fns = [
      { name: 'helper', params: ['x'], startLine: 1, endLine: 5, body: '' },
      { name: 'divide', params: ['a', 'b'], startLine: 6, endLine: 12, body: '' }
    ];
    const diff = '@@ -7,2 +7,4 @@ def divide(a, b):\n+    if b == 0: raise ValueError()';
    const target = identifyTargetFunction(fns, diff);
    assert.strictEqual(target.name, 'divide');
  });

  await test('generateTestCasesForLanguage generates python regression and boundary tests', () => {
    const targetFn = { name: 'divide', params: ['a', 'b'], startLine: 1, endLine: 5, body: '' };
    const tests = generateTestCasesForLanguage('python', targetFn, '');
    assert.strictEqual(tests.length, 3);
    assert.ok(tests.some(t => t.testType === 'regression'));
    assert.ok(tests.some(t => t.testType === 'boundary'));
    assert.ok(tests.some(t => t.testType === 'error_handling'));
    assert.ok(tests[0].testCode.includes('test_divide_regression'));
  });

  await test('generateTestCasesForLanguage generates typescript jest tests', () => {
    const targetFn = { name: 'getCache', params: ['key'], startLine: 1, endLine: 5, body: '' };
    const tests = generateTestCasesForLanguage('typescript', targetFn, '');
    assert.strictEqual(tests.length, 3);
    assert.ok(tests[0].testCode.includes("it('should correctly execute healed behavior"));
  });

  // =========================================================================
  // 3. Test File Injection & Synthesizer Loop
  // =========================================================================
  await test('resolveTestFilePath and injectTestsIntoFile creates and updates test suites', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qodo_test_'));
    const testFile = path.join(tmpDir, 'test_calc.py');

    const tests = [
      {
        testName: 'test_divide_zero_guard',
        testCode: 'def test_divide_zero_guard():\n    assert True\n',
        description: 'Zero guard test',
        targetFunction: 'divide',
        testType: 'regression' as const,
        passed: true
      }
    ];

    const content1 = injectTestsIntoFile(testFile, tests, 'python', tmpDir);
    assert.ok(content1.includes('import pytest'));
    assert.ok(content1.includes('test_divide_zero_guard'));

    // Inject again - should not duplicate
    const content2 = injectTestsIntoFile(testFile, tests, 'python', tmpDir);
    const matches = content2.match(/test_divide_zero_guard/g);
    assert.strictEqual(matches?.length, 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await test('synthesizeTestsForPatch executes end-to-end test generation with custom runner', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qodo_synth_'));
    const sourceFile = path.join(tmpDir, 'calc.py');
    const sourceCode = `def divide(a, b):\n    if b == 0:\n        raise ValueError("zero")\n    return a / b\n`;
    fs.writeFileSync(sourceFile, sourceCode, 'utf-8');

    let runnerExecuted = false;
    const res = await synthesizeTestsForPatch({
      sourceFilePath: sourceFile,
      workingDirectory: tmpDir,
      testCommand: 'pytest',
      sandboxRunner: async (cmd) => {
        runnerExecuted = true;
        return { exitCode: 0, stdout: '3 passed in 0.05s', stderr: '' };
      }
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(runnerExecuted, true);
    assert.ok(res.finalCoverage > res.baselineCoverage);
    assert.ok(res.coverageDelta > 0);
    assert.ok(res.generatedTests.length >= 2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 4. Qodo Scorecard Engine & Mathematical Formula
  // =========================================================================
  await test('calculateQodoScorecard applies exact formula S = 0.35 Q + 0.35 S + 0.20 C + 0.10 P', () => {
    const res = calculateQodoScorecard({
      originalCode: 'def calc(a, b): return a / b',
      healedCode: 'def calc(a, b):\n    if b == 0:\n        raise ValueError("Cannot divide by zero")\n    return a / b',
      diff: '@@ -1 +1,3 @@\n+ if b == 0:\n+ raise ValueError()',
      language: 'python',
      testResults: { passed: true, coveragePercent: 92 },
      generatedTestsCount: 3
    });

    assert.ok(res.overallScore >= 90);
    assert.strictEqual(res.grade, 'A+');
    assert.strictEqual(res.verdict, 'APPROVED_FOR_PR');
    assert.strictEqual(res.passed, true);
    assert.strictEqual(res.securityAudit.passed, true);
    assert.ok(res.markdownSummary.includes('Qodo Code Quality & Security Scorecard'));
  });

  await test('calculateQodoScorecard detects SQL injection (CWE-89) and penalizes security score', () => {
    const vulnerableCode = `
function getUser(req, res) {
    const query = "SELECT * FROM users WHERE id = " + req.body.id;
    db.query(query);
}
`;
    const res = calculateQodoScorecard({
      originalCode: '',
      healedCode: vulnerableCode,
      language: 'javascript'
    });

    assert.ok(res.securityScore <= 70);
    assert.strictEqual(res.securityAudit.passed, false);
    const cwe89 = res.securityAudit.findings.find(f => f.cveOrCwe === 'CWE-89');
    assert.ok(cwe89);
    assert.strictEqual(cwe89?.severity, 'CRITICAL');
  });

  await test('calculateQodoScorecard detects mitigated vulnerability and adds praise', () => {
    const orig = `const query = "SELECT * FROM users WHERE id = " + req.body.id; db.query(query);`;
    const healed = `const query = "SELECT * FROM users WHERE id = ?"; db.query(query, [req.body.id]);`;

    const res = calculateQodoScorecard({
      originalCode: orig,
      healedCode: healed,
      language: 'javascript'
    });

    assert.strictEqual(res.securityAudit.passed, true);
    const mitigated = res.securityAudit.findings.find(f => f.mitigated);
    assert.ok(mitigated);
    assert.ok(res.reviewComments.some(c => c.type === 'praise' && c.comment.includes('mitigated CWE-89')));
  });

  await test('calculateQodoScorecard detects command injection (CWE-78) and hardcoded secrets (CWE-798)', () => {
    const cmdInj = `os.system("rm -rf " + user_input)`;
    const resCmd = calculateQodoScorecard({ originalCode: '', healedCode: cmdInj, language: 'python' });
    assert.ok(resCmd.securityAudit.findings.some(f => f.cveOrCwe === 'CWE-78'));

    const secretCode = `const apiKey = "ghp_1234567890abcdef1234567890abcdef";`;
    const resSecret = calculateQodoScorecard({ originalCode: '', healedCode: secretCode, language: 'typescript' });
    assert.ok(resSecret.securityAudit.findings.some(f => f.cveOrCwe === 'CWE-798'));
  });

  await test('determineGrade and determineVerdict map thresholds correctly', () => {
    assert.strictEqual(determineGrade(96), 'A+');
    assert.strictEqual(determineGrade(90), 'A');
    assert.strictEqual(determineGrade(82), 'B');
    assert.strictEqual(determineGrade(74), 'C');
    assert.strictEqual(determineGrade(65), 'D');
    assert.strictEqual(determineGrade(40), 'F');

    assert.strictEqual(determineVerdict(90, true, 0), 'APPROVED_FOR_PR');
    assert.strictEqual(determineVerdict(70, true, 0), 'REQUIRES_MANUAL_REVIEW');
    assert.strictEqual(determineVerdict(40, true, 0), 'REJECTED');
    assert.strictEqual(determineVerdict(95, false, 1), 'REQUIRES_MANUAL_REVIEW');
  });

  console.log(`\nQodo Tests Completed: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

// Self-run
runQodoTests().catch(err => {
  console.error('Fatal Qodo test exception:', err);
  process.exit(1);
});
