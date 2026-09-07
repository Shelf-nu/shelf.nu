/**
 * Scan-time eligibility rules for the booking check-out scanner.
 *
 * The scanner rejects an ineligible scan on the spot rather than collecting it
 * and letting the submit fail, so these rules mirror the web partial-check-out
 * drawer's blockers (`isAssetCheckoutEligible` + its call-site membership
 * check) closely enough that a scan accepted here is a scan the server will
 * take.
 *
 * A scanned QR carries only the asset's identity and global status — the
 * booking-scoped facts (`type`, `remainingToCheckOut`) live on the booking's
 * own rows. So every rule past membership is evaluated against the matching
 * `BookingAsset` row, which is also what the submit path patches in place: a
 * re-scan of something just checked out is rejected without a refetch.
 *
 * Pure by design — no React Native, Expo or `@/` imports — so it runs under
 * Node's test runner via tsx.
 *
 * @see {@link file://./../app/(tabs)/scanner.tsx} the only consumer
 * @see {@link file://./booking-scan-eligibility.test.ts}
 */
import type { BookingAsset } from "./api/types";

/** Why a scan was refused: an alert title and the sentence under it. */
export type ScanBlockReason = { title: string; message: string };

/**
 * The booking facts the rules read. A subset of the scanner's `bookingCtx`,
 * narrowed to what eligibility needs and widened to readonly so callers can
 * pass their live state without copying.
 */
export type CheckoutEligibilityContext = {
  /** Every asset id on the booking, including ones already checked out. */
  bookedAssetIds: ReadonlySet<string>;
  /** Assets already returned on this booking — never checked out again. */
  checkedInAssetIds: ReadonlySet<string>;
  /** The booking's asset rows, carrying the booking-scoped quantity counts. */
  bookedAssets: readonly BookingAsset[];
};

/** The identity a QR scan yields: enough to find the row and name it in an alert. */
export type ScannedAssetIdentity = { id: string; title: string };

/**
 * Decide whether a scanned asset can be checked out on this booking.
 *
 * @param scanned Identity from the resolved QR code.
 * @param ctx The booking's membership sets and asset rows.
 * @returns `null` when the asset is eligible, otherwise the reason to show.
 */
export function checkoutBlocker(
  scanned: ScannedAssetIdentity,
  ctx: CheckoutEligibilityContext
): ScanBlockReason | null {
  const row = ctx.bookedAssets.find((a) => a.id === scanned.id);

  if (!ctx.bookedAssetIds.has(scanned.id) || !row) {
    return {
      title: "Not in This Booking",
      message: `"${scanned.title}" is not part of this booking.`,
    };
  }

  if (ctx.checkedInAssetIds.has(scanned.id)) {
    return {
      title: "Already Returned",
      message: `"${scanned.title}" was already checked in for this booking.`,
    };
  }

  if (row.status === "IN_CUSTODY") {
    return {
      title: "In Custody",
      message: `"${scanned.title}" is in custody — release custody first.`,
    };
  }

  // A quantity-tracked asset is judged by its remaining booked units, not by a
  // global status that says nothing about this booking's slice. An older
  // server omits the count; then the status rule below is the best available
  // answer, which is what the booking screen and the web helper also fall back
  // to.
  if (
    row.type === "QUANTITY_TRACKED" &&
    typeof row.remainingToCheckOut === "number"
  ) {
    return row.remainingToCheckOut <= 0
      ? {
          title: "Already Checked Out",
          message: `"${scanned.title}" has no units left to check out on this booking.`,
        }
      : null;
  }

  if (row.status === "CHECKED_OUT") {
    return {
      title: "Already Checked Out",
      message: `"${scanned.title}" is currently checked out (on this or another booking).`,
    };
  }

  return null;
}

/** The kit shape a scan yields, carrying its own membership. */
export type ScannedKitIdentity = {
  id: string;
  name: string;
  assets: { id: string }[];
};

/**
 * Expand a scanned kit into the members that can be checked out now.
 *
 * A kit is never checked out as a unit — it contributes its eligible members,
 * matching the web drawer. Membership is read from the kit's own payload
 * unioned with rows whose `kitId` points at it: a kit added to a booking from
 * the phone is stored as standalone rows, so the booking rows alone do not
 * name every member.
 *
 * @param kit The resolved kit, with the asset ids it contains.
 * @param ctx The booking's membership sets and asset rows.
 * @param alreadyScannedIds Asset ids already sitting in the scan list.
 * @returns The rows to add, or the single reason nothing could be added.
 */
export function eligibleKitMembers(
  kit: ScannedKitIdentity,
  ctx: CheckoutEligibilityContext,
  alreadyScannedIds: ReadonlySet<string>
): { eligible: BookingAsset[]; reason: ScanBlockReason | null } {
  const memberIds = new Set(
    kit.assets.filter((a) => ctx.bookedAssetIds.has(a.id)).map((a) => a.id)
  );
  for (const row of ctx.bookedAssets) {
    if (row.kitId === kit.id) memberIds.add(row.id);
  }

  const members = ctx.bookedAssets.filter((row) => memberIds.has(row.id));

  if (members.length === 0) {
    return {
      eligible: [],
      reason: {
        title: "Not in This Booking",
        message: `None of "${kit.name}"'s assets are part of this booking.`,
      },
    };
  }

  const checkoutable = members.filter(
    (row) => checkoutBlocker({ id: row.id, title: row.title }, ctx) === null
  );

  if (checkoutable.length === 0) {
    return {
      eligible: [],
      reason: {
        title: "Already Checked Out",
        message: `All of "${kit.name}"'s assets in this booking are already checked out.`,
      },
    };
  }

  const eligible = checkoutable.filter((row) => !alreadyScannedIds.has(row.id));

  if (eligible.length === 0) {
    return {
      eligible: [],
      reason: {
        title: "Already Covered",
        message: `All of "${kit.name}"'s assets in this booking are already in your check-out list.`,
      },
    };
  }

  return { eligible, reason: null };
}
