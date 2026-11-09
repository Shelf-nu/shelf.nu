/**
 * An in-memory response cache that belongs to one signed-in account.
 *
 * Cached lists (team members, locations, categories) are what the server
 * returned for the account that asked, and some are role-scoped. The cache is
 * therefore emptied whenever the account changes (sign-out, or a different
 * user signing in), and every write is tagged with the account generation it
 * started in, so a request still in flight when the account changed can
 * never repopulate it.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it. `./cache.ts` wires it to the live Supabase client.
 *
 * @see {@link file://./account-cache.test.ts}
 * @see {@link file://./cache.ts}
 */

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
   * Reports the signed-in user, as auth events arrive. A different user (or
   * none) empties the cache; the same user (a token refresh) keeps it.
   *
   * @param userId - The signed-in user's id, or null when signed out
   */
  observeUser: (userId: string | null) => void;
  /** Empties the cache and starts a new account generation. */
  resetAccount: () => void;
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
  let generation = 0;
  /** undefined until the first auth event, so that event is not a "change". */
  let currentUserId: string | null | undefined;

  function resetAccount() {
    entries.clear();
    generation += 1;
  }

  return {
    get(key, ttl, now) {
      const entry = entries.get(key);
      if (!entry || now - entry.cachedAt >= ttl) return undefined;
      return entry.data;
    },
    set(key, data, startedIn, now) {
      if (startedIn !== generation) return false;
      entries.set(key, { data, cachedAt: now });
      return true;
    },
    generation: () => generation,
    observeUser(userId) {
      if (currentUserId !== undefined && userId !== currentUserId) {
        resetAccount();
      }
      currentUserId = userId;
    },
    resetAccount,
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
