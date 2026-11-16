/**
 * Response cache for low-churn data.
 *
 * Team members, locations, and categories rarely change during a session.
 * Caching these responses avoids redundant network calls when pickers are
 * opened multiple times (e.g. assign custody, then change location).
 *
 * The cache belongs to one server AND one signed-in account
 * (`./account-cache.ts`): a server switch, a sign-out, or a different user
 * signing in empties it, and a response that comes back after any of those
 * is not stored.
 *
 * @see {@link file://./account-cache.ts}
 */
import { createAccountCachedFetch } from "./account-cache";
import { accountGeneration, apiFetch } from "./client";

const RESPONSE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

// Bound to the app's one account counter, which the token cache and the audit
// scan queue read too, so all three agree on when the account changed.
const responseCache = createAccountCachedFetch({
  account: accountGeneration,
  fetch: apiFetch,
});

/**
 * Clears cached API responses: all of them, or those whose path starts with
 * a prefix (call after mutations that affect cached data).
 *
 * @param keyPrefix - Only paths starting with this are cleared
 */
export function invalidateResponseCache(keyPrefix?: string) {
  responseCache.invalidate(keyPrefix);
}

/**
 * Wraps apiFetch with in-memory caching for GET requests. A response that
 * arrives after the account changed (sign-out, another user, a server switch)
 * is not stored and comes back as an error, so the caller reloads.
 *
 * @param path - The request path, which is also the cache key
 * @param ttl - Maximum age of a cached response in milliseconds
 * @returns The cached or fetched response, in `apiFetch`'s envelope
 */
export function cachedApiFetch<T>(
  path: string,
  ttl: number = RESPONSE_CACHE_TTL_MS
): Promise<{ data: T | null; error: string | null }> {
  return responseCache.cachedFetch<T>(path, ttl);
}
