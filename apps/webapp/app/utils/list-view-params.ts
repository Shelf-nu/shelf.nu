/**
 * Client-side list/overview view params.
 *
 * Some list/overview pages (e.g. the booking overview) filter, sort, and
 * paginate **entirely in the browser** from data already loaded once — so
 * changing these params must NOT trigger a server revalidation of the route or
 * any of its ancestor layout routes. This module defines that param set and the
 * shared `shouldRevalidate` predicate that ancestor routes use to opt out of
 * revalidation for such navigations.
 *
 * `per_page` is intentionally NOT included: changing the page size updates a
 * server-side cookie and cannot be satisfied purely client-side, so it must
 * still revalidate.
 *
 * @see {@link file://../modules/booking/booking-overview-client-cache.ts}
 * @see {@link file://../modules/booking/shape-booking-assets.ts}
 * @see docs/superpowers/specs/2026-06-01-booking-asset-search-in-memory-design.md
 */
import type { ShouldRevalidateFunction } from "react-router";

/** Search params handled purely client-side (no server refetch needed). */
export const CLIENT_VIEW_PARAM_KEYS = [
  "s",
  "orderBy",
  "orderDirection",
  "page",
] as const;

/**
 * True when navigating from `currentUrl` to `nextUrl` is a same-path navigation
 * whose only differing search params are client view params (search/sort/page).
 *
 * @param currentUrl - The URL being navigated away from
 * @param nextUrl - The URL being navigated to
 * @returns Whether the change is purely a client-handled view change
 */
export function isClientViewOnlyNavigation(
  currentUrl: URL,
  nextUrl: URL
): boolean {
  if (currentUrl.pathname !== nextUrl.pathname) {
    return false;
  }
  const withoutViewParams = (url: URL): string => {
    const params = new URLSearchParams(url.searchParams);
    for (const key of CLIENT_VIEW_PARAM_KEYS) {
      params.delete(key);
    }
    params.sort();
    return params.toString();
  };
  return withoutViewParams(currentUrl) === withoutViewParams(nextUrl);
}

/**
 * Shared `shouldRevalidate` for ancestor routes of a page that does its own
 * client-side filtering/sorting/pagination. Skips revalidation for same-path
 * client-view-only GET navigations; defers to the default (which revalidates)
 * for mutations and any real navigation, so data stays correct.
 */
export const skipRevalidationOnClientViewChange: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  // Submissions (mutations) must always revalidate to refresh data.
  if (formMethod && formMethod !== "GET") {
    return defaultShouldRevalidate;
  }
  if (isClientViewOnlyNavigation(currentUrl, nextUrl)) {
    return false;
  }
  return defaultShouldRevalidate;
};
