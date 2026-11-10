/**
 * An in-memory response cache that belongs to one signed-in account, and the
 * wiring that keeps it that way.
 *
 * Cached lists (team members, locations, categories) are what the server
 * returned for the account that asked, and some are role-scoped. The cache is
 * emptied whenever the account changes (sign-out, a different user signing
 * in, a server switch, or a session ended without an auth event), and a
 * response that comes back after such a change is neither stored nor handed
 * to the caller.
 *
 * Who counts as "the account" is decided by `./auth-generation.ts`, the same
 * rule the access-token cache uses: a token refresh is not a change, and the
 * first auth event after a server switch is not one either (the switch itself
 * already started a new generation).
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it. `./cache.ts` wires it to the live Supabase client.
 *
 * @see {@link file://./account-cache.test.ts}
 * @see {@link file://./cache.ts}
 * @see {@link file://./auth-generation.ts}
 */
import { createAuthGeneration } from "./auth-generation";

/** One cached response. */
type Entry = { data: unknown; cachedAt: number };

/** A response cache scoped to the signed-in account. */
export type AccountScopedCache = {
  /**
   * Reads a fresh entry.
   *
   * @param key - The request path
   * @param ttl - Maximum age in milliseconds
   * @param now - The current time
   * @returns The cached data, or undefined when absent or stale
   */
  get: (key: string, ttl: number, now: number) => unknown | undefined;
  /**
   * Stores a response, unless the account changed since the request began.
   *
   * @param key - The request path
   * @param data - The response data
   * @param generation - {@link AccountScopedCache.generation} read when the
   *   request started
   * @param now - The current time
   * @returns True when stored
   */
  set: (key: string, data: unknown, generation: number, now: number) => boolean;
  /** The current account generation; it changes on every account change. */
  generation: () => number;
  /**
   * Reports the user an auth event carries. A different user, or none,
   * empties the cache; the first report and a token refresh keep it.
   *
   * @param userId - The signed-in user's id, or null when signed out
   */
  observeUser: (userId: string | null) => void;
  /** Empties the cache and starts a new generation (a session ended). */
  resetAccount: () => void;
  /**
   * Empties the cache for a server switch: a new generation, and the new
   * client's first auth event is not counted as another change.
   */
  serverChanged: () => void;
  /**
   * Removes entries, all of them or those whose key starts with a prefix.
   * Leaves the account generation alone.
   *
   * @param keyPrefix - Only keys starting with this are removed
   */
  invalidate: (keyPrefix?: string) => void;
};

/**
 * Creates an empty account-scoped cache.
 *
 * @returns The cache
 */
export function createAccountScopedCache(): AccountScopedCache {
  const entries = new Map<string, Entry>();
  const account = createAuthGeneration();

  return {
    get(key, ttl, now) {
      const entry = entries.get(key);
      if (!entry || now - entry.cachedAt >= ttl) return undefined;
      return entry.data;
    },
    set(key, data, startedIn, now) {
      if (startedIn !== account.current()) return false;
      entries.set(key, { data, cachedAt: now });
      return true;
    },
    generation: () => account.current(),
    observeUser(userId) {
      if (account.observe(userId)) entries.clear();
    },
    resetAccount() {
      entries.clear();
      account.bump();
    },
    serverChanged() {
      entries.clear();
      account.bump();
      account.forgetUser();
    },
    invalidate(keyPrefix) {
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

/** The error a cached fetch returns when the account changed mid-request. */
export const SESSION_CHANGED_ERROR = "Your session changed. Please try again.";

/** A response envelope, as `apiFetch` returns it. */
export type FetchResult<T> = { data: T | null; error: string | null };

/**
 * Wires an account-scoped cache to the app: auth events of the live client,
 * the end of every session, and server switches.
 *
 * @param options.subscribeAuth - Listens to the live client's auth events,
 *   reporting each event's user id (null when signed out); returns an
 *   unsubscribe function. Called again after every server switch, because the
 *   switch replaces the client.
 * @param options.onSessionEnd - Registers a task for the end of any session
 * @param options.onServerChange - Registers a task for a server switch
 * @param options.fetch - Performs one request
 * @param options.now - The clock
 * @returns `cachedFetch` and `invalidate`
 */
export function createAccountCachedFetch({
  subscribeAuth,
  onSessionEnd,
  onServerChange,
  fetch,
  now = Date.now,
}: {
  subscribeAuth: (listener: (userId: string | null) => void) => () => void;
  onSessionEnd: (task: () => void) => void;
  onServerChange: (task: () => void) => void;
  fetch: <T>(path: string) => Promise<FetchResult<T>>;
  now?: () => number;
}) {
  const cache = createAccountScopedCache();
  let unsubscribe = subscribeAuth((userId) => cache.observeUser(userId));

  onServerChange(() => {
    cache.serverChanged();
    unsubscribe();
    unsubscribe = subscribeAuth((userId) => cache.observeUser(userId));
  });
  // A sign-out that had to delete the stored session itself emits no auth
  // event, so the end of every session also empties the cache.
  onSessionEnd(() => cache.resetAccount());

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
      const cached = cache.get(path, ttl, now());
      if (cached !== undefined) return { data: cached as T, error: null };
      const generationAtStart = cache.generation();
      const result = await fetch<T>(path);
      if (cache.generation() !== generationAtStart) {
        return { data: null, error: SESSION_CHANGED_ERROR };
      }
      if (result.data && !result.error) {
        cache.set(path, result.data, generationAtStart, now());
      }
      return result;
    },
    /** @see AccountScopedCache.invalidate */
    invalidate: (keyPrefix?: string) => cache.invalidate(keyPrefix),
  };
}
