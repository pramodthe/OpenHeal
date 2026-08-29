/**
 * LRU Cache implementation with TTL support (Fixed).
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

    // Refresh access order (delete and re-insert)
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.value;
  }

  public set(key: string, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = effectiveTtl ? Date.now() + effectiveTtl : undefined;

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Evict least recently used (first key in Map iterator)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
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
