export interface ScenarioItem {
  id: string;
  name: string;
  language: 'python' | 'node' | 'rust' | 'go';
  description: string;
  testFramework: 'pytest' | 'jest' | 'cargo' | 'gotest';
  targetRepoUrl: string;
  targetFiles: string[];
  expectedBugType: string;
  estimatedDurationMs: number;
  testCommand: string;
  baselineLogSnippet?: string;
}

export const SCENARIO_CATALOG: ScenarioItem[] = [
  {
    id: 'demo-web-app',
    name: 'Demo Web App (Behavioral UI bugs)',
    language: 'node',
    description: 'Small task board with broken submit flow — ideal for Explorer agent PR reviews.',
    testFramework: 'jest',
    targetRepoUrl: 'https://github.com/openheal-demo/demo-web-app',
    targetFiles: ['public/tasks.html', 'public/app.js', 'server.js'],
    expectedBugType: 'BehavioralRegression',
    estimatedDurationMs: 6000,
    testCommand: 'npm start',
    baselineLogSnippet: 'Explorer: broken-submit on /tasks.html',
  },
  {
    id: 'python-calculator',
    name: 'Python Calculator (Div/0 & Float Precision)',
    language: 'python',
    description: 'ZeroDivisionError during division operation and floating point precision rounding bug in core calculation engine.',
    testFramework: 'pytest',
    targetRepoUrl: 'https://github.com/openheal-demo/python-calculator',
    targetFiles: ['calculator/calculator.py', 'tests/test_calculator.py'],
    expectedBugType: 'ZeroDivisionError',
    estimatedDurationMs: 4200,
    testCommand: 'PYTHONPATH=. python3 -m pytest -v tests/ || python3 -m unittest discover -s tests -v',
    baselineLogSnippet: 'FAILED tests/test_calculator.py::test_divide_by_zero - ZeroDivisionError: division by zero',
  },
  {
    id: 'node-api-cache',
    name: 'Node.js Express Cache TTL (Memory Leak)',
    language: 'node',
    description: 'Off-by-one boundary validation on cache entry expiration leading to unbounded memory leak and stale response invalidation failure.',
    testFramework: 'jest',
    targetRepoUrl: 'https://github.com/openheal-demo/node-api-cache',
    targetFiles: ['src/cache.ts', 'tests/cache.test.ts'],
    expectedBugType: 'MatcherError',
    estimatedDurationMs: 4800,
    testCommand: 'node --experimental-strip-types --test tests/cache.test.ts',
    baselineLogSnippet: 'FAIL tests/cache.test.ts\n  ● Cache › should expire entries after TTL\n    expect(received).toBe(expected) // Expected: undefined, Received: "active_user"',
  },
  {
    id: 'rust-parser',
    name: 'Rust JSON Stream Parser (Escaped Quotes)',
    language: 'rust',
    description: 'JSON string tokenizer drops escaped quotes, so `"Hello \\"World\\""` terminates the string too early.',
    testFramework: 'cargo',
    targetRepoUrl: 'https://github.com/openheal-demo/rust-parser',
    targetFiles: ['src/parser.rs', 'tests/parser_tests.rs'],
    expectedBugType: 'AssertionError',
    estimatedDurationMs: 5600,
    testCommand: 'cargo test -- --nocapture',
    baselineLogSnippet: 'test tests::test_tokenize_escaped_quotes_in_string ... FAILED',
  },
];

/** Bundled scenarios that run the self-heal pipeline (excludes review-only demo-web-app). */
export const HEAL_LAB_SCENARIOS = SCENARIO_CATALOG.filter((s) => s.id !== 'demo-web-app');
