/**
 * Over-commitment derivation for a quantity pool.
 *
 * Answers the question the asset page was silent about: **not just "is there a
 * problem" but "how much, and which booking is the biggest part of it".**
 *
 * The assets index can say `Short · 2 short` because the SQL names the booking.
 * The asset page, the page you land on to FIX it, listed four numbers and
 * never said the pool was over-committed at all. That is a diagnosis with no
 * treatment, and it is the gap this closes.
 *
 * Pure and separate from the card so the rule is unit-testable, and so both
 * surfaces state the same shortfall. It defers to `committedUnits` from
 * `@shelf/quantity-control` rather than re-adding the claims by hand, the same
 * helper `classifyStockStatus` uses, so the page and the index can never quote
 * different numbers for the same asset.
 *
 * The booking figure is the PEAK, not the largest booking: the most units owed
 * to bookings at any single instant from now on, which is what
 * `getAssetAvailability` returns as `reserved` for a window starting now. Two
 * bookings of six that overlap peak at twelve; the largest-booking reading
 * would have said nothing was wrong.
 *
 * @see {@link file://../../../../packages/quantity-control/src/stock-status.ts}
 * @see {@link file://../../components/assets/quantity-overview-card.tsx}
 */

import { committedUnits } from "@shelf/quantity-control";

/** Everything needed to judge whether a pool is promised beyond its size. */
export type OverCommitmentInput = {
  /** `Asset.quantity`, or null for an individually-tracked asset. */
  total: number | null;
  /** Units in direct custody (kit-inherited custody sits inside `inKits`). */
  inCustody: number;
  inKits: number;
  /** The most units owed to standalone bookings at one instant ahead. */
  peakBooked: number;
  /** The single upcoming booking asking for the most units, when known. */
  topBooking: { id: string; name: string; units: number } | null;
};

/** The verdict, or null when the pool is within its size. */
export type OverCommitment = {
  /** Units promised beyond what the workspace owns. Always > 0. */
  shortBy: number;
  /** Units bookings need at the busiest point ahead. */
  peak: number;
  /** Units held back from bookings today: direct custody plus kit units. */
  held: number;
  /** The biggest single booking in that peak, when it could be identified. */
  booking: { id: string; name: string; units: number } | null;
};

/**
 * Decides whether a pool is over-committed at some point ahead.
 *
 * @param input - See {@link OverCommitmentInput}.
 * @returns The shortfall and its biggest contributor, or null when nothing is
 *   over-promised.
 */
export function resolveOverCommitment(
  input: OverCommitmentInput
): OverCommitment | null {
  const { total, inCustody, inKits, peakBooked, topBooking } = input;

  if (total == null) return null;

  const shortBy = committedUnits({ inCustody, inKits, peakBooked }) - total;

  if (shortBy <= 0) return null;

  return {
    shortBy,
    peak: peakBooked,
    held: inCustody + inKits,
    booking: topBooking,
  };
}
