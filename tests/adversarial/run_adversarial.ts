#!/usr/bin/env node
import { globalHarness } from '../e2e/runner.ts';
import './adversarial_trueforge_swarm.test.ts';

async function main() {
  console.log('\n🔥 RUNNING ADVERSARIAL STRESS TEST SUITE 🔥\n');
  const result = await globalHarness.run();
  if (result.failed > 0) {
    console.error(`\n❌ Adversarial verification failed: ${result.failed} tests failed!`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${result.passed} adversarial stress tests PASSED!`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
