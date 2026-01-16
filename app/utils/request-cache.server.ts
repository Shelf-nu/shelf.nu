import { AsyncLocalStorage } from "node:async_hooks";

const requestCacheStorage = new AsyncLocalStorage<
  Map<string, Map<string, unknown>>
>();

export function runWithRequestCache<T>(fn: () => T) {
  return requestCacheStorage.run(new Map(), fn);
}

/**
 * Returns a per-request cache bucket by key when called inside a
 * runWithRequestCache context; otherwise returns null so callers can
 * fall back to uncached behavior.
 */
export function getRequestCache<T extends Map<string, unknown>>(key: string) {
  const store = requestCacheStorage.getStore();
  if (!store) {
    return null;
  }

  let cache = store.get(key);
  if (!cache) {
    cache = new Map<string, unknown>();
    store.set(key, cache);
  }

  return cache as T;
}
