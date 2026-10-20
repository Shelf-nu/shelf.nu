/**
 * Booking Quantity
 *
 * How many units of a quantity-tracked asset a booking may hold, what the
 * quantity sheet opens on, and when a booked amount may be edited. The picker,
 * the scanner's add-to-booking mode and the booking screen all ask these
 * questions, and must answer them the same way.
 *
 * Every number the sheet sends is the booking's new TOTAL for the asset, never
 * an amount to add: the server sets the standalone slice to it. That is why a
 * sheet for an asset the booking already holds opens on what it holds.
 *
 * The server enforces every rule here again; these only keep the phone from
 * offering an answer it would refuse.
 *
 * @see {@link file://../app/(tabs)/bookings/add-assets.tsx} picker
 * @see {@link file://../app/(tabs)/scanner.tsx} scanner, add-to-booking mode
 * @see {@link file://../app/(tabs)/bookings/[id].tsx} booking screen
 */

import type { AssetType } from "./api/types";

/** What the server reports about one asset for one booking. */
export type BookingQuantityFacts = {
  /**
   * Units free for the booking's dates with this booking excluded
   * (`bookable` / `availableQuantity`). Absent on older servers.
   */
  available?: number | null;
  /** Units the booking's standalone slice already holds; null when none. */
  booked?: number | null;
  /** The asset's whole pool: the fallback when `available` is absent. */
  pool?: number | null;
};

/**
 * The most units the booking may hold of the asset; 0 when it can take none.
 *
 * `available` already excludes this booking, so it is the full amount the
 * booking may hold, not an amount on top of what it has. What the booking
 * already holds is never cut: a pool over-committed elsewhere can report less
 * free than the booking holds, and keeping (or lowering) the held amount is
 * always allowed.
 *
 * @param facts - The server's counts for the asset and booking
 * @returns The cap for the quantity sheet
 */
export function bookingQuantityCap({
  available,
  booked,
  pool,
}: BookingQuantityFacts): number {
  return Math.max(available ?? pool ?? 0, booked ?? 0, 0);
}

/**
 * The amount the quantity sheet opens on: what the booking already holds, so
 * confirming without a change changes nothing, otherwise 1.
 *
 * @param facts.booked - Units the booking already holds
 * @returns The sheet's starting value
 */
export function bookingQuantityDefault({
  booked,
}: Pick<BookingQuantityFacts, "booked">): number {
  return booked && booked > 0 ? booked : 1;
}

/** The parts of a booking-screen row that decide whether it may be resized. */
export type BookedQuantityRow = {
  type?: AssetType;
  kit: { id: string } | null;
  assetKitId?: string | null;
  slices?: { assetKitId: string | null }[];
  /** Units this booking has sent out of the asset. Absent on older servers. */
  dispatchedUnitsTotal?: number;
};

/**
 * Whether a booking-screen row offers the booked-quantity editor.
 *
 * Only one standalone slice of a quantity-tracked asset qualifies: a
 * kit-driven slice takes its amount from the kit, and a row merging several
 * slices has no single amount to edit. A row whose units have gone out keeps
 * its amount, as the server requires. Status and role rules are the screen's
 * to apply on top.
 *
 * @param row - The booking-screen row
 * @returns `true` when the row's booked amount may be changed
 */
export function canEditBookedQuantity(row: BookedQuantityRow): boolean {
  if (row.type !== "QUANTITY_TRACKED") return false;
  if (row.kit || (row.assetKitId ?? null) !== null) return false;
  const slices = row.slices ?? [];
  if (slices.length > 1) return false;
  if (slices.length === 1 && slices[0].assetKitId !== null) return false;
  return (row.dispatchedUnitsTotal ?? 0) === 0;
}
