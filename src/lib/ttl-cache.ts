type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type PendingEntry<T> = {
  promise: Promise<T>;
};

type GlobalCacheState = {
  values: Map<string, CacheEntry<unknown>>;
  pending: Map<string, PendingEntry<unknown>>;
};

const globalForTtlCache = globalThis as typeof globalThis & {
  __turnoutTtlCache?: GlobalCacheState;
};

function getCacheState(): GlobalCacheState {
  if (!globalForTtlCache.__turnoutTtlCache) {
    globalForTtlCache.__turnoutTtlCache = {
      values: new Map(),
      pending: new Map(),
    };
  }

  return globalForTtlCache.__turnoutTtlCache;
}

export async function getOrSetTtlCache<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const state = getCacheState();
  const now = Date.now();
  const cached = state.values.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const pending = state.pending.get(key);

  if (pending) {
    return pending.promise as Promise<T>;
  }

  const promise = factory()
    .then((value) => {
      state.values.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      state.pending.delete(key);
      return value;
    })
    .catch((error) => {
      state.pending.delete(key);
      throw error;
    });

  state.pending.set(key, { promise });

  return promise;
}
