/**
 * useAssetBookings — the bookings one asset appears in.
 *
 * Backs the Bookings section on the asset detail screen, which answers the two
 * questions a field worker asks while holding the thing: when is it out next,
 * and where has it been. Web has had this as a tab on the asset page for a long
 * time; the companion had no way to ask at all, since even the bookings list
 * endpoint cannot filter by asset.
 *
 * Fetches lazily — only once the section is opened — so the asset screen keeps
 * its current load cost for the majority of visits that never expand it.
 *
 * @see {@link file://../lib/api/assets.ts} `assetsApi.assetBookings`
 */
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import type { AssetBookingRow } from "@/lib/api/types";

type UseAssetBookingsResult = {
  bookings: AssetBookingRow[];
  totalCount: number;
  isLoading: boolean;
  /** Set once a fetch has completed, so an empty list renders as "none". */
  hasLoaded: boolean;
  error: string | null;
  /** Idempotent: safe to call on every expand. */
  load: () => Promise<void>;
};

export function useAssetBookings(
  assetId: string | undefined,
  orgId: string | undefined
): UseAssetBookingsResult {
  const [bookings, setBookings] = useState<AssetBookingRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!assetId || !orgId || isLoading) return;

    setIsLoading(true);
    setError(null);

    const res = await api.assetBookings(assetId, orgId, { perPage: 20 });

    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setBookings(res.data.bookings);
      setTotalCount(res.data.totalCount);
      setHasLoaded(true);
    }

    setIsLoading(false);
  }, [assetId, orgId, isLoading]);

  return { bookings, totalCount, isLoading, hasLoaded, error, load };
}
