/**
 * Remembered list filters
 *
 * The lists that remember their filters (assets, bookings, kits) keep them in a
 * per-workspace cookie. A visit to the bare path (`/assets`) restores them by
 * redirecting to `/assets?<filters>`, which makes the browser run every loader
 * of the page twice: once to learn about the redirect, once for real.
 *
 * Within a session the app already knows those filters: they are the query
 * string the list last rendered with, which the server accepted. This module
 * remembers it per workspace and list, and the app's own links to a list
 * (sidebar, command palette) point straight at it, so the loader finds the
 * filters in the URL and never redirects. A list not visited yet in this tab
 * keeps the bare path, and the cookie redirect still applies there.
 *
 * What is remembered goes through {@link cleanParamsForFilterCookie}, the same
 * rule the cookie uses, so a link restores exactly what the redirect would.
 *
 * @see {@link file://./search-params/index.ts} cleanParamsForFilterCookie
 * @see {@link file://../utils/cookies.server.ts} getFiltersFromRequest, the redirect
 * @see {@link file://../routes/_layout+/_layout.tsx} where the lists are watched
 */
import { useCallback, useEffect } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useLocation } from "react-router";
import type { AllowedPathname } from "./search-params";
import {
  ALLOWED_FILTER_PATHNAMES,
  cleanParamsForFilterCookie,
} from "./search-params";
import { useCurrentOrganization } from "./use-current-organization";

/** The path of a list that remembers its filters, such as `/assets`. */
export type FilteredListPath = `/${AllowedPathname}`;

/**
 * The filters each list last rendered with in this tab, keyed by
 * {@link rememberedSearchKey}.
 */
const rememberedListSearchAtom = atom<Record<string, string>>({});

/**
 * Key of one list's remembered filters. Workspaces keep separate filter
 * cookies, so they keep separate memories too.
 *
 * @param organizationId - The workspace the list belongs to
 * @param path - The list's path
 * @returns The key under which the list's filters are remembered
 */
export function rememberedSearchKey(
  organizationId: string,
  path: FilteredListPath
): string {
  return `${organizationId}:${path}`;
}

/**
 * The list a pathname shows, if it is one of the lists that remember their
 * filters. Only the list itself counts: `/assets/new` is not the asset list.
 *
 * @param pathname - A URL pathname
 * @returns The list path, or `null` for any other page
 */
export function filteredListPathOf(pathname: string): FilteredListPath | null {
  const segment = pathname.replace(/^\//, "").replace(/\/$/, "");
  return segment in ALLOWED_FILTER_PATHNAMES
    ? (`/${segment}` as FilteredListPath)
    : null;
}

/**
 * Builds the href of a link, adding a list's remembered filters when the link
 * points at the bare list.
 *
 * @param to - The link target, such as `/assets` or `/settings`
 * @param remembered - The remembered filters, keyed by {@link rememberedSearchKey}
 * @param organizationId - The current workspace, when known
 * @returns `to` with the remembered query string, or `to` unchanged for any
 *   other link, an unvisited list, or a list remembered without filters
 */
export function withRememberedFilters(
  to: string,
  remembered: Record<string, string>,
  organizationId: string | undefined
): string {
  const path = filteredListPathOf(to);
  if (!path || to !== path || !organizationId) return to;
  const search = remembered[rememberedSearchKey(organizationId, path)];
  return search ? `${path}?${search}` : path;
}

/**
 * Remembers the filters of the list on screen. Call once, in the layout that
 * holds every list, so each visit is recorded whichever way it was reached.
 */
export function useRememberListFilters(): void {
  const { pathname, search } = useLocation();
  const organizationId = useCurrentOrganization()?.id;
  const setRemembered = useSetAtom(rememberedListSearchAtom);

  useEffect(() => {
    const path = filteredListPathOf(pathname);
    if (!path || !organizationId) return;
    const key = rememberedSearchKey(organizationId, path);
    const cleaned = cleanParamsForFilterCookie(search);
    setRemembered((previous) =>
      previous[key] === cleaned ? previous : { ...previous, [key]: cleaned }
    );
  }, [pathname, search, organizationId, setRemembered]);
}

/**
 * A function that turns a link target into its href, with a list's
 * remembered filters added (see {@link withRememberedFilters}).
 *
 * @returns The resolver; other targets pass through unchanged
 */
export function useRememberedListHref(): (to: string) => string {
  const organizationId = useCurrentOrganization()?.id;
  const remembered = useAtomValue(rememberedListSearchAtom);
  return useCallback(
    (to: string) => withRememberedFilters(to, remembered, organizationId),
    [remembered, organizationId]
  );
}
