/**
 * List context for detail pages: the row links of an index attach it as
 * history state, and the detail page reads it to step to the previous or
 * next record with `RecordNavigation`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import type {
  ListContext,
  ListEntity,
  NeighbourRef,
  Neighbours,
} from "~/modules/list-navigation/list-context";
import {
  LIST_DETAIL_PATH,
  readListContext,
  withPage,
} from "~/modules/list-navigation/list-context";

/** History state a list row link carries to its detail page. */
export type ListContextLinkState = { listContext: ListContext };

/**
 * The `state` for a list row's link, so the detail page it opens can step
 * through this list. Pass it as `state` on the row's `Link` or `Button`.
 *
 * @param entity - Which list the row belongs to
 * @returns History state naming the list and its current search string
 */
export function useListContextLinkState(
  entity: ListEntity
): ListContextLinkState {
  const { search } = useLocation();
  return useMemo(() => ({ listContext: { entity, search } }), [entity, search]);
}

/** What the neighbours endpoint answers: the neighbours, or an error payload. */
type NeighboursResponse = Partial<Neighbours> & { error?: unknown };

/** Where a detail page stands in the list it was opened from. */
export type RecordNavigationState = {
  /**
   * `no-context` when the page was not opened from a list (direct link,
   * bookmark, reload), `loading` while the neighbours load, `ready` after.
   */
  status: "no-context" | "loading" | "ready";
  prev: NeighbourRef | null;
  next: NeighbourRef | null;
  /** Opens a neighbour's detail page and carries the list context along. */
  goTo: (neighbour: NeighbourRef) => void;
};

/** Fetcher key prefix for the neighbours load; excluded from the global progress bar. */
export const RECORD_NAVIGATION_FETCHER_PREFIX = "record-navigation-";

/**
 * Previous/next navigation for a detail page opened from a list.
 *
 * Reads the list context from history state, loads the neighbours once per
 * record, and listens for `[` (previous) and `]` (next). Call it ONCE per
 * page and hand the result to `RecordNavigation`: the header renders its
 * children twice (desktop and mobile rows), and a listener per copy would
 * step twice.
 *
 * @param entity - Which list this detail page belongs to
 * @param id - The record on screen
 * @param enabled - `false` turns the load and the keyboard off, for child
 *   routes that hide the header
 */
export function useRecordNavigation({
  entity,
  id,
  enabled = true,
}: {
  entity: ListEntity;
  id: string;
  enabled?: boolean;
}): RecordNavigationState {
  const location = useLocation();
  const navigate = useNavigate();

  const stateContext = readListContext(
    (location.state as { listContext?: unknown } | null)?.listContext
  );
  const searchFromState =
    stateContext?.entity === entity ? stateContext.search : null;

  /**
   * The context outlives navigations inside the same record: a tab link
   * (Overview, Activity, ...) carries no history state, yet the user is still
   * on the record they opened from the list. Kept per record id, so opening
   * another record without a context still disables the arrows.
   */
  const [kept, setKept] = useState<{ id: string; search: string } | null>(null);
  if (
    searchFromState !== null &&
    (kept?.id !== id || kept.search !== searchFromState)
  ) {
    setKept({ id, search: searchFromState });
  }
  const search = searchFromState ?? (kept?.id === id ? kept.search : null);

  const fetcher = useFetcher<NeighboursResponse>({
    key: `${RECORD_NAVIGATION_FETCHER_PREFIX}${entity}-${id}`,
  });
  const { load } = fetcher;

  const url =
    search === null
      ? null
      : `/api/list-neighbours?${new URLSearchParams({
          entity,
          id,
          filters: search.replace(/^\?/, ""),
        }).toString()}`;

  useEffect(() => {
    if (enabled && url) void load(url);
  }, [enabled, url, load]);

  /**
   * The url a load has started for. A load that ends with no data (a network
   * failure) leaves the fetcher idle with `data` undefined; once a load for
   * this url has run, that reads as "ready, no neighbours" rather than
   * loading forever.
   */
  const [startedUrl, setStartedUrl] = useState<string | null>(null);
  if (fetcher.state !== "idle" && url !== null && startedUrl !== url) {
    setStartedUrl(url);
  }

  const data = fetcher.data;
  const status: RecordNavigationState["status"] =
    search === null
      ? "no-context"
      : fetcher.state !== "idle"
      ? "loading"
      : data !== undefined || startedUrl === url
      ? "ready"
      : "loading";
  // A failed load leaves both arrows disabled, like the ends of the list.
  const prev = status === "ready" && !data?.error ? data?.prev ?? null : null;
  const next = status === "ready" && !data?.error ? data?.next ?? null : null;

  const goTo = useCallback(
    (neighbour: NeighbourRef) => {
      if (search === null) return;
      const state: ListContextLinkState = {
        listContext: { entity, search: withPage(search, neighbour.page) },
      };
      void navigate(LIST_DETAIL_PATH[entity](neighbour.id), { state });
    },
    [entity, search, navigate]
  );

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "[" && event.key !== "]") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      // An open dialog, menu, listbox or popover owns the keyboard.
      if (document.querySelector(OVERLAY_SELECTOR)) return;
      const neighbour = event.key === "[" ? prev : next;
      if (!neighbour) return;
      event.preventDefault();
      goTo(neighbour);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, prev, next, goTo]);

  return { status, prev, next, goTo };
}

/** Open overlays that own the keyboard while they are on screen. */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** `true` when a key press is typing into a field rather than a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return (
    target.isContentEditable ||
    target.closest('[contenteditable=""], [contenteditable="true"]') !== null
  );
}
