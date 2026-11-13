/**
 * Loads a workspace's full location list for the asset forms' Location field.
 *
 * The field searches only the rows it holds, so it needs every page, not the
 * first. Shared by the create screen and the edit form so both follow the
 * same rules:
 *
 * - Only the latest load commits: a slow load for a previous workspace cannot
 *   replace the current list.
 * - With no workspace (signed out), the list is emptied and any load still in
 *   flight is dropped.
 * - When a later page fails, a complete list this workspace already shows is
 *   kept. Without one, the pages that did load are shown, and never another
 *   workspace's list.
 * - A list that is not whole says so: `error` when a page failed, `truncated`
 *   when the page walk hit its hard stop.
 *
 * @see {@link file://./../lib/fetch-all-pages.ts}
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageResult } from "../lib/fetch-all-pages";
import { fetchAllPages } from "../lib/fetch-all-pages";

/** Fetches one page of a workspace's locations. */
export type FetchLocationsPage<L> = (
  orgId: string,
  page: number,
  perPage: number
) => Promise<PageResult<{ locations: L[] }>>;

/** What {@link useAllLocations} hands the Location field. */
export type AllLocations<L> = {
  /** The rows the field offers and searches. */
  locations: L[];
  /** True while the latest load is in flight. */
  isLocationsLoading: boolean;
  /**
   * Why `locations` is not the whole list: the message of the page that
   * failed. `null` when the load succeeded, and when a failed reload left a
   * complete list in place.
   */
  error: string | null;
  /** True when the page walk hit its hard stop, so later rows are missing. */
  truncated: boolean;
  /** Starts a load for the current workspace; also the retry after an error. */
  loadLocations: () => Promise<void>;
};

/**
 * Loads every page of a workspace's locations and keeps only the latest
 * load's result, so the Location field never shows another workspace's rows
 * or a stale list. The caller starts the first load (and any retry) with
 * `loadLocations`; nothing is fetched on mount.
 *
 * @param orgId - The current workspace, or nothing when signed out.
 * @param fetchPage - Fetches one page (the screens pass `api.locations`).
 * @returns The rows, whether a load is in flight, whether and why the rows
 *   are incomplete (`error`, `truncated`), and `loadLocations` to load or
 *   retry. See {@link AllLocations}.
 */
export function useAllLocations<L extends { id: string }>(
  orgId: string | null | undefined,
  fetchPage: FetchLocationsPage<L>
): AllLocations<L> {
  const [locations, setLocations] = useState<L[]>([]);
  const [isLocationsLoading, setIsLocationsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  /** Bumped by every load; a load whose id is no longer the latest is dropped. */
  const latestRequestRef = useRef(0);
  /** The workspace whose complete list is shown, if any. */
  const completeOrgRef = useRef<string | null>(null);

  /** `fetchPage` may be a new function each render; keep the latest here. */
  const fetchPageRef = useRef(fetchPage);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
  });

  // Leaving the screen drops the load in flight, so its page walk stops after
  // the page it is on instead of fetching the rest for nobody.
  useEffect(
    () => () => {
      latestRequestRef.current += 1;
    },
    []
  );

  const loadLocations = useCallback(async () => {
    if (!orgId) {
      latestRequestRef.current += 1;
      completeOrgRef.current = null;
      setLocations([]);
      setError(null);
      setTruncated(false);
      setIsLocationsLoading(false);
      return;
    }

    const requestId = ++latestRequestRef.current;
    setIsLocationsLoading(true);
    const result = await fetchAllPages(
      (page, perPage) => fetchPageRef.current(orgId, page, perPage),
      (data) => data.locations,
      {
        isCurrent: () => requestId === latestRequestRef.current,
        fallbackError: "Failed to load locations",
      }
    );
    if (requestId !== latestRequestRef.current) return;

    if (!result.error) {
      setLocations(result.rows);
      setError(null);
      setTruncated(result.truncated);
      // A list cut off at the hard stop is not complete: a later failed
      // reload must not keep it as the fallback.
      completeOrgRef.current = result.truncated ? null : orgId;
    } else if (completeOrgRef.current === orgId) {
      // The complete list from an earlier load stays, so nothing is missing.
      setError(null);
      setTruncated(false);
    } else {
      setLocations(result.rows);
      setError(result.error);
      setTruncated(false);
      completeOrgRef.current = null;
    }
    setIsLocationsLoading(false);
  }, [orgId]);

  return { locations, isLocationsLoading, error, truncated, loadLocations };
}
