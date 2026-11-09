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
import {
  getServerVersion,
  subscribeToServerChange,
} from "../server/active-server";
import { onAfterSessionEnd } from "../server/session-end";
import { getSupabase } from "../supabase";
import { createAccountScopedCache } from "./account-cache";
import { apiFetch } from "./client";

const RESPONSE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const responseCache = createAccountScopedCache();

/**
 * Clears cached API responses: all of them, or those whose path starts with
 * a prefix (call after mutations that affect cached data).
 *
 * @param keyPrefix - Only paths starting with this are cleared
 */
export function invalidateResponseCache(keyPrefix?: string) {
  responseCache.invalidate(keyPrefix);
}

/** Unsubscribe handle for the current client's auth listener. */
let authSubscription: { unsubscribe: () => void } | null = null;

/**
 * Follows the CURRENT Supabase client's auth events, so the cache empties when
 * the signed-in user changes. Re-called after every server switch, because the
 * switch replaces the client.
 */
function attachAuthListener(): void {
  authSubscription?.unsubscribe();
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange((_event, session) => {
    responseCache.observeUser(session?.user?.id ?? null);
  });
  authSubscription = subscription;
}

attachAuthListener();

// why: cached list responses belong to the server they were fetched from, so
// a switch must flush them. Subscribing here rather than being called from
// active-server.ts keeps the dependency one-way (api -> server).
subscribeToServerChange(() => {
  responseCache.resetAccount();
  attachAuthListener();
});

// A sign-out that had to delete the stored session itself emits no auth
// event, so the end of every session also empties the cache.
onAfterSessionEnd(() => responseCache.resetAccount());

/**
 * Wraps apiFetch with in-memory caching for GET requests.
 *
 * @param path - The request path, which is also the cache key
 * @param ttl - Maximum age of a cached response in milliseconds
 * @returns The cached or fetched response, in `apiFetch`'s envelope
 */
export async function cachedApiFetch<T>(
  path: string,
  ttl: number = RESPONSE_CACHE_TTL_MS
): Promise<{ data: T | null; error: string | null }> {
  const cached = responseCache.get(path, ttl, Date.now());
  if (cached !== undefined) {
    return { data: cached as T, error: null };
  }
  const versionAtStart = getServerVersion();
  const generationAtStart = responseCache.generation();
  const result = await apiFetch<T>(path);
  // A server switch during the request already flushed the cache, so this
  // response belongs to the previous server and is not stored. A sign-out or a
  // change of user during the request discards the response entirely.
  if (responseCache.generation() !== generationAtStart) {
    // The account changed while the request was out: the response belongs to
    // the previous account, so the caller gets an error and reloads instead.
    return { data: null, error: "Your session changed. Please try again." };
  }
  if (result.data && !result.error && getServerVersion() === versionAtStart) {
    responseCache.set(path, result.data, generationAtStart, Date.now());
  }
  return result;
}
