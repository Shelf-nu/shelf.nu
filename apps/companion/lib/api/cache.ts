import { apiFetch } from "./client";

// ── Response cache for low-churn data ───────────────────
// Team members, locations, and categories rarely change during a session.
// Caching these responses avoids redundant network calls when pickers
// are opened multiple times (e.g. assign custody → change location).
const RESPONSE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const responseCache = new Map<string, { data: unknown; cachedAt: number }>();

/** Clear all cached API responses (call after mutations that affect cached data). */
export function invalidateResponseCache(keyPrefix?: string) {
  if (!keyPrefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.startsWith(keyPrefix)) responseCache.delete(key);
  }
}

/** Wraps apiFetch with in-memory caching for GET requests. */
export async function cachedApiFetch<T>(
  path: string,
  ttl: number = RESPONSE_CACHE_TTL_MS
): Promise<{ data: T | null; error: string | null }> {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && now - cached.cachedAt < ttl) {
    return { data: cached.data as T, error: null };
  }
  const result = await apiFetch<T>(path);
  if (result.data && !result.error) {
    responseCache.set(path, { data: result.data, cachedAt: Date.now() });
  }
  return result;
}
