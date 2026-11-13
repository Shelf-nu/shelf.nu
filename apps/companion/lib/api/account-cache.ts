/**
 * An in-memory response cache that belongs to one signed-in account.
 *
 * Cached lists (team members, locations, categories) are what the server
 * returned for the account that asked, and some are role-scoped. The cache is
 * emptied whenever the app's account counter (`./account-generation.ts`)
 * moves: sign-out, a different user signing in, a server switch, or a session
 * ended without an auth event. A response that comes back after such a change
 * is neither stored nor handed to the caller.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it. `./cache.ts` wires it to the app's account counter and `apiFetch`.
 *
 * @see {@link file://./account-cache.test.ts}
 * @see {@link file://./cache.ts}
 * @see {@link file://./account-generation.ts}
 */
import type { AccountGeneration } from "./account-generation";

/** One cached response. */
type Entry = { data: unknown; cachedAt: number };

/** The error a cached fetch returns when the account changed mid-request. */
export const SESSION_CHANGED_ERROR = "Your session changed. Please try again.";

/** A response envelope, as `apiFetch` returns it. */
export type FetchResult<T> = { data: T | null; error: string | null };

/**
 * Creates a response cache bound to an account counter.
 *
 * @param options.account - The app's account counter
 * @param options.fetch - Performs one request
 * @param options.now - The clock
 * @returns `cachedFetch` and `invalidate`
 */
export function createAccountCachedFetch({
  account,
  fetch,
  now = Date.now,
}: {
  account: AccountGeneration;
  fetch: <T>(path: string) => Promise<FetchResult<T>>;
  now?: () => number;
}) {
  const entries = new Map<string, Entry>();
  account.onChange(() => entries.clear());

  return {
    /**
     * Returns a fresh cached response, or fetches one and caches it. A
     * response that arrives after the account changed belongs to the previous
     * account: it is not stored, and the caller gets
     * {@link SESSION_CHANGED_ERROR} and reloads.
     *
     * @param path - The request path, which is also the cache key
     * @param ttl - Maximum age of a cached response in milliseconds
     * @returns The response envelope
     */
    async cachedFetch<T>(path: string, ttl: number): Promise<FetchResult<T>> {
      const cached = entries.get(path);
      if (cached && now() - cached.cachedAt < ttl) {
        return { data: cached.data as T, error: null };
      }
      const generationAtStart = account.current();
      const result = await fetch<T>(path);
      if (account.current() !== generationAtStart) {
        return { data: null, error: SESSION_CHANGED_ERROR };
      }
      if (result.data && !result.error) {
        entries.set(path, { data: result.data, cachedAt: now() });
      }
      return result;
    },
    /**
     * Removes entries, all of them or those whose key starts with a prefix
     * (call after mutations that affect cached data).
     *
     * @param keyPrefix - Only keys starting with this are removed
     */
    invalidate(keyPrefix?: string) {
      if (!keyPrefix) {
        entries.clear();
        return;
      }
      for (const key of entries.keys()) {
        if (key.startsWith(keyPrefix)) entries.delete(key);
      }
    },
  };
}
