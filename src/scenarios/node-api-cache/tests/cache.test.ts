import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { ApiCache } from '../src/cache.ts';

describe('ApiCache Test Suite', () => {
  test('should set and get basic keys', () => {
    const cache = new ApiCache<string>(5);
    cache.set('user:1', 'Alice');
    cache.set('user:2', 'Bob');

    assert.equal(cache.get('user:1'), 'Alice');
    assert.equal(cache.get('user:2'), 'Bob');
    assert.equal(cache.get('user:999'), undefined);
  });

  test('should expire items after TTL', async () => {
    const cache = new ApiCache<number>(10);
    cache.set('temp', 42, 50);

    assert.equal(cache.get('temp'), 42);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(cache.get('temp'), undefined);
  });

  test('should evict oldest key on capacity overflow (LRU order)', () => {
    const cache = new ApiCache<string>(3);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3');

    // Access k1 so k2 becomes the least recently used
    assert.equal(cache.get('k1'), 'v1');

    // Insert k4, which should trigger eviction of k2
    cache.set('k4', 'v4');

    assert.equal(cache.get('k1'), 'v1', 'k1 should still exist because it was accessed');
    assert.equal(cache.get('k2'), undefined, 'k2 should have been evicted as the oldest unaccessed entry');
    assert.equal(cache.get('k3'), 'v3');
    assert.equal(cache.get('k4'), 'v4');
  });
});
