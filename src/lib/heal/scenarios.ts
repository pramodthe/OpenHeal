import path from 'node:path';
import fs from 'node:fs';
import type { SupportedLanguage } from '../daytona/types.ts';

export const BUNDLED_SCENARIO_IDS = ['python-calculator', 'node-api-cache', 'rust-parser', 'demo-web-app'] as const;

const SCENARIO_LANGUAGE: Record<string, SupportedLanguage> = {
  'python-calculator': 'python',
  'node-api-cache': 'node',
  'rust-parser': 'rust',
  'demo-web-app': 'node',
};

const SCENARIO_TEST_COMMAND: Record<string, string> = {
  'python-calculator':
    'PYTHONPATH=. python3 -m pytest -v tests/ || python3 -m unittest discover -s tests -v',
  'node-api-cache': 'node --experimental-strip-types --test tests/cache.test.ts',
  'rust-parser': 'cargo test -- --nocapture',
};

export function languageForScenario(scenarioId?: string): SupportedLanguage | undefined {
  if (!scenarioId) return undefined;
  return SCENARIO_LANGUAGE[scenarioId];
}

export function testCommandForScenario(scenarioId?: string): string | undefined {
  if (!scenarioId) return undefined;
  return SCENARIO_TEST_COMMAND[scenarioId];
}

export function resolveBundledScenarioDir(scenarioId?: string): string | null {
  if (!scenarioId || !BUNDLED_SCENARIO_IDS.includes(scenarioId as (typeof BUNDLED_SCENARIO_IDS)[number])) {
    return null;
  }

  const candidates = [
    path.resolve(process.cwd(), 'src/scenarios', scenarioId),
    path.resolve(process.cwd(), 'openheal/src/scenarios', scenarioId),
    path.resolve(process.cwd(), '../src/scenarios', scenarioId),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

export function defaultTestCommand(language?: string, override?: string): string | undefined {
  if (override?.trim()) return override.trim();
  switch (language) {
    case 'python':
      return 'PYTHONPATH=. python3 -m pytest -v tests/ || python3 -m unittest discover -s tests -v';
    case 'node':
      return 'node --experimental-strip-types --test tests/cache.test.ts || npm test';
    case 'rust':
      return 'cargo test -- --nocapture';
    case 'go':
      return 'go test -v ./...';
    default:
      return undefined;
  }
}
