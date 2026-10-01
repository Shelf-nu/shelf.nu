/**
 * The assets that stop a booking being reserved, named.
 *
 * `Asset.availableToBook` is an administrator's "may this be booked at all"
 * flag. It is independent of `Asset.status`, so a flagged asset still reads
 * AVAILABLE wherever status is shown while `getBookingFlags` refuses the whole
 * booking over it. Reporting only that some asset is flagged leaves the
 * operator opening every kit to find it.
 *
 * Pure, so the rules below can be tested without a booking page. The loader
 * feeds it rows it has already fetched, so this costs no extra query.
 *
 * @see {@link file://./service.server.ts} `getBookingFlags`, which decides
 *   whether Reserve is blocked at all. This module only explains its verdict,
 *   and must read the same field for the two to agree.
 */

/** One blocking asset, and the kit it sits in on this booking. */
export type UnavailableAssetRow = {
  id: string;
  title: string;
  /** `null` when the asset is on the booking in its own right. */
  kitName: string | null;
};

/**
 * A booking row as the overview loader shapes it: the asset's own fields
 * spread flat, plus the kit this particular row was booked under.
 */
type BookingAssetRow = {
  id: string;
  title: string;
  availableToBook: boolean;
  kit: { name: string } | null;
};

/**
 * Names every asset on the booking that is not bookable.
 *
 * @param rows - The booking's asset rows, one per `BookingAsset` slice.
 * @returns The blocking assets in the order they appear, each at most once.
 */
export function buildUnavailableAssets(
  rows: BookingAssetRow[]
): UnavailableAssetRow[] {
  // One row per slice, so an asset split across a standalone row and two kits
  // arrives three times. The flag is on the asset, and turning it back on
  // fixes every slice at once, so it is named once.
  const seen = new Set<string>();
  const unavailable: UnavailableAssetRow[] = [];

  for (const row of rows) {
    if (row.availableToBook || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    unavailable.push({
      id: row.id,
      title: row.title,
      // The first slice's kit is enough to find the asset. Naming every kit a
      // multi-slice asset appears in would lengthen the list without changing
      // what has to be done to it.
      kitName: row.kit?.name ?? null,
    });
  }

  return unavailable;
}
