/**
 * Whether an INDIVIDUAL booking slice is still out.
 *
 * The one per-slice test behind every "is this booking finished?" decision: the
 * completion gate (`isBookingFullyCheckedIn`) and the progressive check-in's
 * all-returned shortcut both call it, so they cannot disagree about whether an
 * item is back.
 *
 * A slice is out from its first departure until a return answers its LATEST
 * departure. The slice marker dates only the first one: the progressive
 * checkout keeps `checkedOutAt` when a returned slice goes out again and clears
 * `checkedInAt`, so a later departure is dated by its `PartialBookingCheckout`
 * session and nowhere else. A check-in session names an asset for good, so a
 * return recorded for an earlier trip stays on record after the slice leaves
 * again, and read against the first departure it would report the new trip as
 * already over.
 *
 * `QUANTITY_TRACKED` slices are judged by unit arithmetic instead and never
 * reach this test.
 *
 * Pure: no database access, safe to import from any module.
 */
import type { BookingAsset } from "@prisma/client";

/** The slice fields the test reads. */
export type IndividualSliceMarkers = Pick<
  BookingAsset,
  "assetId" | "checkedOutAt" | "checkedInAt"
>;

/** A progressive check-in session: which assets it reconciled, and when. */
type CheckinSessionTimes = {
  assetIds: string[];
  checkinTimestamp: Date | null;
};

/** A progressive check-out session: which assets it sent out, and when. */
type CheckoutSessionTimes = {
  assetIds: string[];
  checkoutTimestamp: Date | null;
};

/**
 * Latest session time per asset id over rows that name the asset. A row
 * without a time dates nothing and is skipped.
 */
function latestTimeByAsset(
  rows: Array<{ assetIds: string[]; at: Date | null }>
): Map<string, Date> {
  const latestByAsset = new Map<string, Date>();
  for (const row of rows) {
    const at = row.at;
    if (!at) continue;
    for (const assetId of row.assetIds) {
      const seen = latestByAsset.get(assetId);
      if (!seen || at > seen) latestByAsset.set(assetId, at);
    }
  }
  return latestByAsset;
}

/**
 * Builds the still-out test for one booking from its progressive sessions.
 *
 * Pass every session of the booking; the test looks up the sessions naming the
 * slice's asset itself.
 *
 * @param sessions.checkinSessions - the booking's `PartialBookingCheckin` rows
 * @param sessions.checkoutSessions - the booking's `PartialBookingCheckout` rows
 * @returns a predicate that is true when the slice went out on this booking
 *   and no return answers its latest departure — the later of its
 *   `checkedOutAt` and the newest check-out session naming the asset. A return
 *   answers it when `checkedInAt`, or the newest check-in session naming the
 *   asset, is no older than that departure. A slice that never went out on this
 *   booking is not out.
 */
export function makeIsIndividualSliceOutstanding({
  checkinSessions,
  checkoutSessions,
}: {
  checkinSessions: CheckinSessionTimes[];
  checkoutSessions: CheckoutSessionTimes[];
}): (slice: IndividualSliceMarkers) => boolean {
  const latestCheckinByAsset = latestTimeByAsset(
    checkinSessions.map((row) => ({
      assetIds: row.assetIds,
      at: row.checkinTimestamp,
    }))
  );
  const latestCheckoutByAsset = latestTimeByAsset(
    checkoutSessions.map((row) => ({
      assetIds: row.assetIds,
      at: row.checkoutTimestamp,
    }))
  );

  return (slice) => {
    if (!slice.checkedOutAt) return false;

    const sessionOutAt = latestCheckoutByAsset.get(slice.assetId);
    const departedAt =
      sessionOutAt && sessionOutAt > slice.checkedOutAt
        ? sessionOutAt
        : slice.checkedOutAt;

    if (slice.checkedInAt && slice.checkedInAt >= departedAt) return false;
    const sessionInAt = latestCheckinByAsset.get(slice.assetId);
    if (sessionInAt && sessionInAt >= departedAt) return false;
    return true;
  };
}
