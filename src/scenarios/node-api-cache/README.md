# Node API Cache Scenario

A broken in-memory LRU cache implementation for OpenHeal self-healing demonstration.

## Failure Description
In `src/cache.ts`, the cache eviction logic in `set()` mistakenly evicts the newly inserted key or the most recently accessed key instead of the least recently used (oldest) key when `maxSize` capacity is exceeded. In addition, `get()` fails to refresh the access order for retrieved keys.

## Running Tests
```bash
npm test
```
