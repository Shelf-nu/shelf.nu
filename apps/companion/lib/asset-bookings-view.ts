/**
 * Asset Bookings View
 *
 * Decides what the asset screen's Bookings section shows from what the
 * `GET /api/mobile/assets/:assetId/bookings` endpoint returned: which rows, in
 * what order, how many sit behind "Show N older", whether the list is cut
 * short of the asset's full history, and how each row names its custodian.
 *
 * Pure, so `pnpm companion:test` pins it without rendering the screen.
 *
 * @see {@link file://../app/(tabs)/assets/[id].tsx} the section that renders it
 * @see {@link file://../hooks/use-asset-bookings.ts} the hook that loads it
 */
import { WITHHELD_CUSTODIAN_NAME } from "@shelf/labels";
import type { AssetBookingRow } from "@/lib/api/types";

/**
 * Rows the section shows before "Show N older". The asset screen is dense, so
 * the preview answers "what is it on now" and leaves history one tap away.
 */
export const BOOKINGS_PREVIEW_COUNT = 3;

/** What the Bookings section renders. */
type AssetBookingsView = {
  /** The rows to draw, in order */
  rows: AssetBookingRow[];
  /** Loaded rows hidden behind "Show N older" (0 once expanded) */
  hiddenCount: number;
  /** Distinct bookings loaded, active ones included */
  loadedCount: number;
  /** The asset has more bookings than were loaded */
  isTruncated: boolean;
};

/**
 * Orders and caps an asset's bookings for the Bookings section.
 *
 * The bookings the asset is out on now lead, then the page in the server's
 * order (newest start first). The page can hold the active bookings too, so
 * they are drawn once.
 *
 * @param args.bookings - One page of the asset's bookings
 * @param args.activeBookings - Its ONGOING and OVERDUE bookings
 * @param args.totalCount - How many bookings the asset has in all
 * @param args.showAll - Whether the user expanded past the preview
 * @param args.previewCount - Rows shown before expanding
 * @returns The rows to draw and the counts the section reports
 */
export function buildAssetBookingsView({
  bookings,
  activeBookings,
  totalCount,
  showAll,
  previewCount = BOOKINGS_PREVIEW_COUNT,
}: {
  bookings: AssetBookingRow[];
  activeBookings: AssetBookingRow[];
  totalCount: number;
  showAll: boolean;
  previewCount?: number;
}): AssetBookingsView {
  const activeIds = new Set(activeBookings.map((b) => b.id));
  const ordered = [
    ...activeBookings,
    ...bookings.filter((b) => !activeIds.has(b.id)),
  ];
  const rows = showAll ? ordered : ordered.slice(0, previewCount);

  return {
    rows,
    hiddenCount: ordered.length - rows.length,
    loadedCount: ordered.length,
    isTruncated: totalCount > ordered.length,
  };
}

/** How a booking row names its custodian. */
type CustodianLabel = {
  text: string;
  /** The viewer may not see who holds the booking */
  isWithheld: boolean;
};

/**
 * The custodian label for a row, or null when the booking has no custodian.
 *
 * A withheld custodian keeps the server's wording, the word the web badge
 * shows, and is flagged so the row can draw it as a placeholder rather than as
 * someone's name.
 *
 * @param custodianName - The row's `custodianName`
 * @returns The text to draw and whether it stands in for a hidden name
 */
export function custodianLabel(
  custodianName: string | null
): CustodianLabel | null {
  if (!custodianName) return null;
  return {
    text: custodianName,
    isWithheld: custodianName === WITHHELD_CUSTODIAN_NAME,
  };
}
