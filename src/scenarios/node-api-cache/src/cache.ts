/**
 * LRU Cache implementation with TTL support.
 * Contains intentional bug in eviction order for self-healing demonstration.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

export class ApiCache<T = unknown> {
  private store: Map<string, CacheEntry<T>>;
  private readonly maxSize: number;
  private readonly defaultTtlMs?: number;

  constructor(maxSize = 100, defaultTtlMs?: number) {
    this.store = new Map();
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // BUG: Missing refresh of key in Map to mark it as most recently used
    return entry.value;
  }

  public set(key: string, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = effectiveTtl ? Date.now() + effectiveTtl : undefined;

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // BUG: Instead of evicting the oldest key (first key), it deletes the current key or doesn't delete the first key properly
      const keys = Array.from(this.store.keys());
      const newestKey = keys[keys.length - 1]; // Wrong: evicts most recent!
      if (newestKey) {
        this.store.delete(newestKey);
      }
    }

    this.store.set(key, { value, expiresAt });
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}
