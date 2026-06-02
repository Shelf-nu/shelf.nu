/**
 * Client-side cache for the booking overview `clientLoader`.
 *
 * Holds the last server-loader response (keyed by bookingId) so that
 * search/sort/pagination navigations can be re-shaped in the browser without a
 * server round-trip. The cache is served ONLY when the navigation is a pure
 * view-param change; first load, a same-URL revalidation (React Router fires
 * one after every action — including child-route mutations), a non-view param
 * change, or a different booking all force a refetch, keeping data correct.
 *
 * @see {@link file://../../utils/list-view-params.ts}
 * @see docs/superpowers/specs/2026-06-01-booking-asset-search-in-memory-design.md
 */
import { CLIENT_VIEW_PARAM_KEYS } from "~/utils/list-view-params";

/**
 * URL search params that can be satisfied purely from cached data (no refetch).
 * Shared with the ancestor-route `shouldRevalidate` so the cache and the
 * revalidation skip stay in lock-step. `per_page` is intentionally excluded —
 * it changes a server cookie and must refetch.
 */
const VIEW_PARAM_KEYS = CLIENT_VIEW_PARAM_KEYS;

type CacheEntry = { bookingId: string; data: unknown };

let cache: CacheEntry | null = null;
let lastNonViewKey: string | null = null;
let lastViewKey: string | null = null;

/** Signature of everything EXCEPT view params (pathname + other params). */
function nonViewKey(url: URL): string {
  const sp = new URLSearchParams(url.searchParams);
  for (const key of VIEW_PARAM_KEYS) sp.delete(key);
  sp.sort();
  return `${url.pathname}?${sp.toString()}`;
}

/** Signature of just the view params. */
function viewKey(url: URL): string {
  const sp = new URLSearchParams();
  for (const key of VIEW_PARAM_KEYS) {
    const value = url.searchParams.get(key);
    if (value != null) sp.set(key, value);
  }
  sp.sort();
  return sp.toString();
}

/** Result of a cache read. */
export type CacheReadResult = { hit: true; data: unknown } | { hit: false };

/**
 * Decides whether the current navigation can be served from cache. On a hit it
 * advances the view baseline so consecutive view changes keep hitting.
 *
 * @param bookingId - The booking being viewed
 * @param url - The current request URL
 */
export function readBookingOverviewCache(
  bookingId: string,
  url: URL
): CacheReadResult {
  const nv = nonViewKey(url);
  const vv = viewKey(url);
  const canServe =
    cache !== null &&
    cache.bookingId === bookingId &&
    lastNonViewKey === nv &&
    lastViewKey !== vv; // view changed → serve; unchanged → refetch
  if (canServe) {
    lastViewKey = vv;
    return { hit: true, data: cache!.data };
  }
  return { hit: false };
}

/**
 * Stores a fresh server-loader response and resets the view/non-view baselines
 * to the current URL.
 *
 * @param bookingId - The booking being viewed
 * @param url - The URL of the request that produced the data
 * @param data - The server-loader response to cache
 */
export function primeBookingOverviewCache(
  bookingId: string,
  url: URL,
  data: unknown
): void {
  cache = { bookingId, data };
  lastNonViewKey = nonViewKey(url);
  lastViewKey = viewKey(url);
}

/** Test-only reset of module state. */
export function __resetBookingOverviewCache(): void {
  cache = null;
  lastNonViewKey = null;
  lastViewKey = null;
}
