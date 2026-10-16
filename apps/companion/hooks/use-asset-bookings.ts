/**
 * useAssetBookings: the bookings one asset appears in.
 *
 * Backs the Bookings section on the asset detail screen, which answers the two
 * questions a field worker asks while holding the thing: when is it out next,
 * and where has it been. Mirrors the Bookings tab on the web asset page.
 *
 * Nothing is fetched until the screen calls `load()`, so the asset screen keeps
 * its load cost for the visits that never open the section. After that, every
 * `load()` re-fetches: the newest request wins and an older answer still in
 * flight is dropped, so a refresh can never be overwritten by the request it
 * replaced. Switching to another asset or workspace clears what was loaded.
 *
 * @see {@link file://../lib/api/assets.ts} `assetsApi.assetBookings`
 * @see {@link file://../lib/asset-bookings-view.ts} what the section draws from it
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import type { AssetBookingRow } from "@/lib/api/types";
import { createLatestRequest } from "@/lib/latest-request";

/** Rows requested per load: enough history for the expanded list. */
const BOOKINGS_PER_PAGE = 20;

/** What {@link useAssetBookings} returns. */
type UseAssetBookingsResult = {
  /** One page of the asset's bookings, newest start first */
  bookings: AssetBookingRow[];
  /** The bookings the asset is out on now, wherever they fall in the paging */
  activeBookings: AssetBookingRow[];
  /** How many bookings the asset has in all */
  totalCount: number;
  isLoading: boolean;
  /** Set once a fetch has completed, so an empty list renders as "none" */
  hasLoaded: boolean;
  error: string | null;
  /** Fetches (or re-fetches) the bookings; supersedes any load in flight */
  load: () => Promise<void>;
};

type State = Omit<UseAssetBookingsResult, "load">;

type Action =
  | { type: "start" }
  | {
      type: "success";
      bookings: AssetBookingRow[];
      activeBookings: AssetBookingRow[];
      totalCount: number;
    }
  | { type: "error"; error: string }
  | { type: "reset" };

const INITIAL_STATE: State = {
  bookings: [],
  activeBookings: [],
  totalCount: 0,
  isLoading: false,
  hasLoaded: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "start":
      return { ...state, isLoading: true, error: null };
    case "success":
      return {
        bookings: action.bookings,
        activeBookings: action.activeBookings,
        totalCount: action.totalCount,
        isLoading: false,
        hasLoaded: true,
        error: null,
      };
    case "error":
      // Keeps rows already on screen: a failed refresh should not blank them.
      return { ...state, isLoading: false, error: action.error };
    case "reset":
      return INITIAL_STATE;
  }
}

/**
 * Loads the bookings one asset appears in, on demand.
 *
 * @param assetId - The asset on screen; nothing loads while it is undefined
 * @param orgId - The active workspace; nothing loads while it is undefined
 * @returns The loaded bookings, the load state and `load()`
 */
export function useAssetBookings(
  assetId: string | undefined,
  orgId: string | undefined
): UseAssetBookingsResult {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const latestRequest = useRef(createLatestRequest()).current;

  // Another asset or workspace: an answer about the old one must not land.
  useEffect(() => {
    latestRequest.cancel();
    dispatch({ type: "reset" });
  }, [assetId, orgId, latestRequest]);

  const load = useCallback(async () => {
    if (!assetId || !orgId) return;

    const signal = latestRequest.begin();
    dispatch({ type: "start" });

    const res = await api.assetBookings(assetId, orgId, {
      perPage: BOOKINGS_PER_PAGE,
      signal,
    });

    if (signal.aborted) return;

    if (res.data) {
      dispatch({
        type: "success",
        bookings: res.data.bookings,
        activeBookings: res.data.activeBookings,
        totalCount: res.data.totalCount,
      });
    } else {
      // Never leave the section spinning on an answer with neither half.
      dispatch({
        type: "error",
        error: res.error ?? "Could not load this asset's bookings.",
      });
    }
  }, [assetId, orgId, latestRequest]);

  return { ...state, load };
}
