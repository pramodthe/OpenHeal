import path from 'node:path';
import fs from 'node:fs';

export const BUNDLED_SCENARIO_IDS = ['python-calculator', 'node-api-cache', 'rust-parser'] as const;

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
