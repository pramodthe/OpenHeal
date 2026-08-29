#!/usr/bin/env node
/**
 * Challenger 2 Adversarial Stress Test Suite Runner
 */

import { globalHarness } from '../e2e/runner.ts';
import './adversarial_stress.test.ts';

async function main() {
  console.log('\n=======================================================');
  console.log('  ⚔️ CHALLENGER 2: EMPIRICAL ADVERSARIAL STRESS RUNNER  ');
  console.log('=======================================================\n');

  const result = await globalHarness.run();
  if (result.failed > 0) {
    console.error(`\n❌ ${result.failed} adversarial stress test(s) failed!`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All ${result.passed} adversarial stress tests passed cleanly!`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
