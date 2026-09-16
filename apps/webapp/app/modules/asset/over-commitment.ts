/**
 * Over-commitment derivation for a quantity pool.
 *
 * Answers the question the asset page was silent about: **not just "is there a
 * problem" but "which booking, and by how much".**
 *
 * The assets index can say `Short · 2 short` because the SQL names the booking.
 * The asset page — the page you land on to FIX it — listed four numbers and
 * never said the pool was over-committed at all, let alone which booking caused
 * it. That is a diagnosis with no treatment, and it is the gap this closes.
 *
 * Pure and separate from the card so the rule is unit-testable, and so both
 * surfaces state the same shortfall. It defers to `committedUnits` from
 * `@shelf/quantity-control` rather than re-adding the claims by hand — the same
 * helper `classifyStockStatus` uses, so the page and the index can never quote
 * different numbers for the same asset.
 *
 * @see {@link file://../../../../../packages/quantity-control/src/stock-status.ts}
 * @see {@link file://../../components/assets/quantity-overview-card.tsx}
 */

import { committedUnits } from "@shelf/quantity-control";

/** One booking's claim on the pool, as the asset page already loads it. */
export type BookingSliceForOverCommitment = {
  quantity?: number | null;
  booking?: {
    id?: string | null;
    name?: string | null;
    status?: string | null;
  } | null;
};

/** Everything needed to judge whether a pool is promised beyond its size. */
export type OverCommitmentInput = {
  /** `Asset.quantity`, or null for an individually-tracked asset. */
  total: number | null;
  inCustody: number;
  inKits: number;
  checkedOut: number;
  /** Every booking slice on this asset; only RESERVED ones are considered. */
  bookingSlices: readonly BookingSliceForOverCommitment[];
};

/** The verdict, or null when the pool is within its size. */
export type OverCommitment = {
  /** Units promised beyond what the workspace owns. Always > 0. */
  shortBy: number;
  /** Units the single biggest upcoming booking asks for. */
  asks: number;
  /** The booking responsible, when it could be identified. */
  booking: { id: string; name: string } | null;
};

/**
 * Decides whether a pool is over-committed, and names the booking responsible.
 *
 * Uses the LARGEST single upcoming booking, never the sum. Bookings that do not
 * overlap in time never compete for the same units, so summing them reports a
 * shortage where none exists — a cable booked once a week for a year would read
 * as permanently over-committed. The largest single booking is a lower bound on
 * peak demand, so it can under-report but can never raise a false alarm.
 *
 * @param input - See {@link OverCommitmentInput}.
 * @returns The shortfall and its cause, or null when nothing is over-promised.
 */
export function resolveOverCommitment(
  input: OverCommitmentInput
): OverCommitment | null {
  const { total, inCustody, inKits, checkedOut, bookingSlices } = input;

  // An individually-tracked asset has no pool to over-commit.
  if (total == null) return null;

  /** Units per upcoming booking — one booking can own several slices. */
  const unitsByBooking = new Map<string, { units: number; name: string }>();
  for (const slice of bookingSlices) {
    if (slice.booking?.status !== "RESERVED") continue;
    const id = slice.booking?.id;
    if (!id) continue;
    const previous = unitsByBooking.get(id);
    const units = (previous?.units ?? 0) + (slice.quantity ?? 0);
    unitsByBooking.set(id, {
      units,
      name: previous?.name ?? slice.booking?.name ?? "Untitled booking",
    });
  }

  let asks = 0;
  let booking: OverCommitment["booking"] = null;
  for (const [id, entry] of unitsByBooking) {
    // Ties resolve to the first seen, which keeps the named booking stable
    // across renders rather than flapping between equals.
    if (entry.units > asks) {
      asks = entry.units;
      booking = { id, name: entry.name };
    }
  }

  const shortBy =
    committedUnits({
      inCustody,
      inKits,
      checkedOut,
      largestUpcomingBooking: asks,
    }) - total;

  if (shortBy <= 0) return null;

  return { shortBy, asks, booking };
}
