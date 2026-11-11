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

/**
 * @param orgId - The current workspace, or nothing when signed out.
 * @param fetchPage - Fetches one page (the screens pass `api.locations`).
 */
export function useAllLocations<L>(
  orgId: string | null | undefined,
  fetchPage: FetchLocationsPage<L>
) {
  const [locations, setLocations] = useState<L[]>([]);
  const [isLocationsLoading, setIsLocationsLoading] = useState(false);

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
      setIsLocationsLoading(false);
      return;
    }

    const requestId = ++latestRequestRef.current;
    setIsLocationsLoading(true);
    const { rows, error, truncated } = await fetchAllPages(
      (page, perPage) => fetchPageRef.current(orgId, page, perPage),
      (data) => data.locations,
      () => requestId === latestRequestRef.current
    );
    if (requestId !== latestRequestRef.current) return;

    if (!error) {
      setLocations(rows);
      // A list cut off at the hard stop is not complete: a later failed
      // reload must not keep it as the fallback.
      completeOrgRef.current = truncated ? null : orgId;
    } else if (completeOrgRef.current !== orgId) {
      setLocations(rows);
      completeOrgRef.current = null;
    }
    setIsLocationsLoading(false);
  }, [orgId]);

  return { locations, setLocations, isLocationsLoading, loadLocations };
}
