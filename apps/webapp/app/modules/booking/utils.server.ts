import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import type { Asset, Booking, Organization, Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Booking";

export function getBookingWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
}): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);

  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as BookingStatus);

  if (status) {
    where.status = status;
  }

  return where;
}

/** This function checks if the booking is expired or not */
export function isBookingExpired({ to }: { to: NonNullable<Booking["to"]> }) {
  try {
    const end = DateTime.fromJSDate(to);
    const now = DateTime.now();

    return end < now;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while checking if the booking is expired.",
      label,
    });
  }
}

/**
 * Calculate partial check-in progress data for a booking
 *
 * Counts progress at the ASSET granularity: every asset (whether standalone or
 * inside a kit) contributes one unit toward the total and one unit toward the
 * checked-in count once it is checked in.
 *
 * The returned object carries `countMode: "assets"` so consumers (e.g. the
 * booking statistics UI) can distinguish it from the unit-based counterpart
 * {@link calculateUnitCheckinProgress}.
 *
 * @param totalAssets - Total number of assets in the booking
 * @param checkedInAssetIds - IDs of assets that have been checked in
 * @param bookingStatus - Optional booking status; COMPLETE/ARCHIVED force 100%
 * @returns Progress data including counts, percentage and `countMode: "assets"`
 */
export function calculatePartialCheckinProgress(
  totalAssets: number,
  checkedInAssetIds: string[],
  bookingStatus?: BookingStatus
) {
  // For final booking statuses, always show 100% progress
  if (
    bookingStatus === BookingStatus.COMPLETE ||
    bookingStatus === BookingStatus.ARCHIVED
  ) {
    return {
      totalAssets,
      checkedInCount: totalAssets,
      uncheckedCount: 0,
      progressPercentage: 100,
      hasPartialCheckins: totalAssets > 0,
      checkedInAssetIds,
      countMode: "assets" as const,
    };
  }

  const checkedInCount = checkedInAssetIds.length;
  const uncheckedCount = totalAssets - checkedInCount;
  const progressPercentage =
    totalAssets > 0 ? Math.round((checkedInCount / totalAssets) * 100) : 0;
  const hasPartialCheckins = checkedInCount > 0;

  return {
    totalAssets,
    checkedInCount,
    uncheckedCount,
    progressPercentage,
    hasPartialCheckins,
    checkedInAssetIds,
    countMode: "assets" as const,
  };
}

/**
 * Calculate unit-based check-in progress for a booking.
 *
 * Unlike {@link calculatePartialCheckinProgress}, this treats each KIT as a
 * single unit instead of counting the individual assets inside it. This backs
 * the workspace `countKitsAsSingleUnit` setting on the booking details
 * "Check-in progress" bar.
 *
 * Counting rules:
 * - Each standalone asset (`kitId === null`) is one unit. It counts as checked
 *   in when its id is in `checkedInAssetIds`.
 * - Each distinct kit is one unit. A kit counts as checked in ONLY when EVERY
 *   asset belonging to it has been checked in. A partially checked-in kit
 *   contributes 0 toward the checked-in count.
 *
 * The total/checked-in numbers therefore represent UNITS, not assets. To keep a
 * shape compatible with the asset-based function, the unit total is still
 * exposed under the `totalAssets` field. The `countMode: "units"` discriminator
 * lets consumers render unit-aware UI.
 *
 * @param bookingAssets - All assets in the booking with their `id` and `kitId`
 * @param checkedInAssetIds - IDs of assets that have been checked in
 * @param bookingStatus - Optional booking status; COMPLETE/ARCHIVED force 100%
 * @returns Progress data including counts, percentage and `countMode: "units"`
 */
export function calculateUnitCheckinProgress(
  bookingAssets: { id: string; kitId: string | null }[],
  checkedInAssetIds: string[],
  bookingStatus?: BookingStatus
) {
  const checkedInSet = new Set(checkedInAssetIds);

  // Standalone assets: each one is a unit.
  const standaloneAssets = bookingAssets.filter(
    (asset) => asset.kitId === null
  );
  const standaloneTotal = standaloneAssets.length;
  const standaloneCheckedIn = standaloneAssets.filter((asset) =>
    checkedInSet.has(asset.id)
  ).length;

  // Group kitted assets by their kitId; each distinct kit is a unit.
  const kitGroups = new Map<string, string[]>();
  for (const asset of bookingAssets) {
    if (asset.kitId === null) {
      continue;
    }
    const existing = kitGroups.get(asset.kitId);
    if (existing) {
      existing.push(asset.id);
    } else {
      kitGroups.set(asset.kitId, [asset.id]);
    }
  }

  const distinctKits = kitGroups.size;
  // A kit is "checked in" only when every one of its assets is checked in.
  let fullyCheckedInKits = 0;
  for (const assetIds of kitGroups.values()) {
    if (assetIds.every((assetId) => checkedInSet.has(assetId))) {
      fullyCheckedInKits += 1;
    }
  }

  // `totalAssets` here represents total UNITS (standalone assets + distinct kits).
  const totalAssets = standaloneTotal + distinctKits;

  // For final booking statuses, always show 100% progress (mirrors the
  // asset-based function's early-return behavior exactly).
  if (
    bookingStatus === BookingStatus.COMPLETE ||
    bookingStatus === BookingStatus.ARCHIVED
  ) {
    return {
      totalAssets,
      checkedInCount: totalAssets,
      uncheckedCount: 0,
      progressPercentage: 100,
      hasPartialCheckins: totalAssets > 0,
      checkedInAssetIds,
      countMode: "units" as const,
    };
  }

  const checkedInCount = standaloneCheckedIn + fullyCheckedInKits;
  const uncheckedCount = totalAssets - checkedInCount;
  const progressPercentage =
    totalAssets > 0 ? Math.round((checkedInCount / totalAssets) * 100) : 0;
  // `hasPartialCheckins` is deliberately ASSET-level, not unit-level: it drives
  // whether the booking page shows the check-in progress section and the
  // per-asset "checked in on/by" columns. A kit with some (but not all) of its
  // assets checked in produces a unit `checkedInCount` of 0, yet there ARE
  // asset-level check-ins to surface — basing this on the kit-unit count would
  // hide that detail. See BookingAssetsColumn / BookingStatistics.
  const hasPartialCheckins = checkedInAssetIds.length > 0;

  return {
    totalAssets,
    checkedInCount,
    uncheckedCount,
    progressPercentage,
    hasPartialCheckins,
    checkedInAssetIds,
    countMode: "units" as const,
  };
}

/**
 * One asset/row's minimal shape for lifecycle bucketing.
 *
 * For INDIVIDUAL assets (the legacy shape) only `id`, `kitId`, and `status` are
 * needed — the row contributes exactly one unit, bucketed by asset status +
 * partial-checkin records. Callers that don't supply `assetType` (or that
 * supply `INDIVIDUAL`) keep the original behavior, preserving backwards
 * compatibility with the existing test fixtures.
 *
 * For QUANTITY_TRACKED rows, the caller MUST provide `bookedQuantity` (B),
 * `checkedOutQuantity` (C), and `dispositionedQuantity` (D) so the bucket math
 * can split that single row's `B` units across the three buckets per the
 * canonical formula:
 *
 *   D' = min(D, C)        // defensive clamp — D should never exceed C
 *   returned   = D'
 *   checkedOut = max(0, C - D')
 *   booked     = max(0, B - C)
 *
 * For COMPLETE/ARCHIVED bookings, the `checkedOut` slice collapses into
 * `returned` (a residual C>D at COMPLETE is treated as having come back),
 * mirroring the INDIVIDUAL-side `finalBucketOf` behavior.
 */
type LifecycleAsset = {
  id: string;
  kitId: string | null;
  status: AssetStatus;
  /** Type of the underlying asset; defaults to INDIVIDUAL when omitted. */
  assetType?: AssetType;
  /** Units booked on this row (BookingAsset.quantity); QT rows only. */
  bookedQuantity?: number;
  /** Units already checked out via PartialBookingCheckout; QT rows only. */
  checkedOutQuantity?: number;
  /** Units dispositioned (returned + consumed + lost + damaged); QT rows only. */
  dispositionedQuantity?: number;
};

/**
 * Result of {@link calculateBookingLifecycleProgress}.
 *
 * The four bucket counts (`bookedCount`, `partialCount`, `checkedOutCount`,
 * `returnedCount`) are MUTUALLY EXCLUSIVE asset-level (or kit-unit-level)
 * counts — each asset contributes exactly one count to exactly one bucket.
 */
export type BookingLifecycleProgress = {
  /**
   * Total ITEMS counted (assets in asset mode; standalone assets + distinct
   * kits in unit mode). Equals `bookedCount + partialCount + checkedOutCount
   * + returnedCount`.
   */
  totalUnits: number;
  bookedCount: number;
  /**
   * Items mid-flight — only QUANTITY_TRACKED rows can land here (some units
   * out or some units returned, but not all). Always 0 at COMPLETE/ARCHIVED.
   */
  partialCount: number;
  checkedOutCount: number;
  returnedCount: number;
  /** partial + checkedOut + returned — items that have left the Booked bucket. */
  checkoutProgressCount: number;
  checkoutProgressPercentage: number;
  /** returned only. */
  checkinProgressCount: number;
  checkinProgressPercentage: number;
  hasPartialCheckouts: boolean;
  hasPartialCheckins: boolean;
  countMode: "assets" | "units";
};

/**
 * Compute the four lifecycle buckets (Booked / Partial / Checked out /
 * Returned) for a booking, backing the segmented progress bar on the booking
 * detail page. Every asset (or kit-unit) contributes exactly ONE count to
 * exactly ONE bucket — there is no per-row unit splitting.
 *
 * Bucket priority chain (top wins) for a single asset:
 * 1. **Returned**:
 *    - INDIVIDUAL: present in `checkedInAssetIds`.
 *    - QUANTITY_TRACKED: `dispositionedQuantity >= bookedQuantity` (every
 *      booked unit has been returned/consumed/lost/damaged).
 * 2. **Checked out** (fully out):
 *    - INDIVIDUAL: `status === CHECKED_OUT`.
 *    - QUANTITY_TRACKED: `checkedOutQuantity >= bookedQuantity` AND
 *      `dispositionedQuantity < bookedQuantity` (every unit out, none back).
 * 3. **Partial** (QT only — INDIVIDUAL can never land here):
 *    - QUANTITY_TRACKED with `0 < checkedOutQuantity < bookedQuantity` OR
 *      `0 < dispositionedQuantity < bookedQuantity` (mid-flight).
 * 4. **Booked**: anything else (reserved, nothing out yet).
 *
 * In unit mode (`countKitsAsSingleUnit`), each standalone asset is one item
 * and each distinct kit is one item bucketed by its member labels:
 * - If ANY member is Partial → the kit is Partial.
 * - Else if all members share a single label → that label.
 * - Else (members disagree across Booked/CheckedOut/Returned) → Booked.
 *
 * For COMPLETE/ARCHIVED bookings, every asset that was ever checked out
 * (`wasCheckedOut` for INDIVIDUAL, `checkedOutQuantity > 0` for QT) collapses
 * to Returned; QT rows that were never out stay Booked. By construction the
 * Partial and Checked-out buckets are 0 at COMPLETE/ARCHIVED.
 *
 * For pre-checkout bookings (DRAFT/RESERVED/CANCELLED) no checkout has happened
 * in THIS booking — only ONGOING/OVERDUE own a live checkout — so every unit is
 * forced into the Booked bucket. This prevents the global asset `status` (which
 * may be CHECKED_OUT because the asset is out in a DIFFERENT booking — e.g.
 * after duplicating an ongoing booking, or reserving an asset that's checked out
 * elsewhere for a future window) from leaking into this booking's progress bar.
 *
 * @returns bucket counts (Booked / Partial / CheckedOut / Returned),
 *   checkout/check-in progress counts + percentages, and convenience flags.
 */
export function calculateBookingLifecycleProgress({
  bookingAssets,
  checkedInAssetIds,
  checkedOutAssetIds = [],
  bookingStatus,
  countKitsAsSingleUnit = false,
}: {
  bookingAssets: LifecycleAsset[];
  checkedInAssetIds: string[];
  /**
   * Asset ids that were ACTUALLY checked out in this booking (have a
   * PartialBookingCheckout record). Used in the COMPLETE/ARCHIVED branch to
   * avoid marking never-checked-out assets as "Returned". An EMPTY array means
   * "no progressive-checkout records" → every asset was checked out (a pure
   * quick/all-at-once checkout leaves no records).
   */
  checkedOutAssetIds?: string[];
  bookingStatus?: BookingStatus;
  countKitsAsSingleUnit?: boolean;
}): BookingLifecycleProgress {
  const countMode = countKitsAsSingleUnit ? "units" : "assets";
  const checkedInSet = new Set(checkedInAssetIds);
  const isFinal =
    bookingStatus === BookingStatus.COMPLETE ||
    bookingStatus === BookingStatus.ARCHIVED;
  // Only ONGOING/OVERDUE bookings own a live checkout, so only there is an
  // asset's global `status === CHECKED_OUT` attributable to THIS booking
  // (conflict detection guarantees an asset can't be live-checked-out in two
  // overlapping bookings). Every pre-checkout state — DRAFT, RESERVED, CANCELLED
  // — has never had any of its own assets checked out: progressive checkout's
  // first scan already flips RESERVED → ONGOING, and a cancelled booking has
  // released its assets. Their assets may still read CHECKED_OUT because they're
  // physically out in a DIFFERENT booking (e.g. after duplicating an ongoing
  // booking into a fresh DRAFT, or reserving an asset for a future window while
  // it's checked out elsewhere now). Force every unit to Booked so cross-booking
  // status never leaks into this booking's progress bar. (COMPLETE/ARCHIVED is
  // handled separately below via `checkedOutAssetIds`, not live status.)
  const isPreCheckout =
    bookingStatus === BookingStatus.DRAFT ||
    bookingStatus === BookingStatus.RESERVED ||
    bookingStatus === BookingStatus.CANCELLED;

  // An asset "was actually checked out" iff it has a checkout record. When no
  // records exist at all (empty array), every asset was checked out.
  const checkedOutSet = new Set(checkedOutAssetIds);
  const wasCheckedOut = (id: string) =>
    checkedOutAssetIds.length === 0 || checkedOutSet.has(id);

  /** Mutually-exclusive bucket label for a single asset (or kit-unit). */
  type Bucket = "booked" | "partial" | "checkedOut" | "returned";

  /**
   * INDIVIDUAL-asset bucket label. Only three buckets are reachable — an
   * individual asset is never `partial` (it is one indivisible unit).
   */
  const individualBucketOf = (
    a: LifecycleAsset
  ): Exclude<Bucket, "partial"> => {
    if (isFinal) {
      // Final bookings: live status is AVAILABLE for every asset at this point,
      // so an asset is "Returned" only if it was ever checked out. CHECKED_OUT
      // live status, if somehow present, is treated as returned defensively.
      return a.status === AssetStatus.CHECKED_OUT || wasCheckedOut(a.id)
        ? "returned"
        : "booked";
    }
    if (a.status === AssetStatus.CHECKED_OUT) return "checkedOut";
    if (checkedInSet.has(a.id)) return "returned";
    return "booked";
  };

  /**
   * QUANTITY_TRACKED-asset bucket label. The priority chain on (B, C, D)
   * collapses one row to one of the four labels — no per-unit splitting.
   *
   * - B = bookedQuantity, C = checkedOutQuantity, D = dispositionedQuantity
   * - Returned:    D >= B (every booked unit accounted for as returned/etc.)
   * - CheckedOut:  C >= B AND D < B  (every unit out, none returned yet)
   * - Partial:     0 < C < B  OR  0 < D < B  (mid-flight)
   * - Booked:      everything else (nothing out, nothing returned)
   *
   * At COMPLETE/ARCHIVED, rows where any units were ever checked out collapse
   * to Returned; rows that were never out stay Booked. Partial and CheckedOut
   * are unreachable in the final branch by construction.
   *
   * QUICK-CHECKOUT CAVEAT: `checkedOutQuantity` (C) is sourced ONLY from
   * `PartialBookingCheckout` rows (progressive checkout). A quick / all-at-once
   * checkout writes NO such rows, so C stays 0 even though every booked unit is
   * physically out. Relying on C alone would mis-bucket such a row as Booked.
   * The reliable "all-at-once happened" signal is `checkedOutAssetIds` being
   * EMPTY (its only source is those same records) — a PER-BOOKING signal. We do
   * NOT use the asset's global `status`: a QUANTITY_TRACKED asset shared across
   * overlapping bookings can read CHECKED_OUT because of a DIFFERENT booking
   * (conflict detection only bars INDIVIDUAL assets from overlapping). We also
   * do NOT use asset-level `wasCheckedOut` for the per-row math — it would
   * over-mark a never-scanned slice of a multi-slice QT asset once ANY sibling
   * slice was checked out.
   */
  const wasAllAtOnceCheckout = checkedOutAssetIds.length === 0;
  const qtyBucketOf = (a: LifecycleAsset): Bucket => {
    const B = Math.max(0, a.bookedQuantity ?? 0);
    let C = Math.max(0, a.checkedOutQuantity ?? 0);
    const D = Math.max(0, a.dispositionedQuantity ?? 0);
    // Quick checkout: an all-at-once checkout of THIS booking (no progressive
    // records ⇒ empty checkedOutAssetIds) put every booked unit out. Only ever
    // raises C toward B, so progressive partial counts are untouched. When
    // records DO exist we trust the per-row counter.
    if (!isFinal && wasAllAtOnceCheckout && D === 0 && C < B) {
      C = B;
    }
    if (isFinal) {
      // Any units ever checked out → Returned; otherwise still Booked. A pure
      // all-at-once checkout leaves no records (C=0), so treat every row as
      // Returned. When records exist, use the per-row C so a never-checked-out
      // slice of a multi-slice QT asset correctly stays Booked.
      return C > 0 || wasAllAtOnceCheckout ? "returned" : "booked";
    }
    if (B > 0 && D >= B) return "returned";
    if (B > 0 && C >= B && D < B) return "checkedOut";
    if ((C > 0 && C < B) || (D > 0 && D < B)) return "partial";
    return "booked";
  };

  /** Dispatch by asset type to the correct single-label resolver. */
  const bucketOf = (a: LifecycleAsset): Bucket => {
    if (a.assetType === AssetType.QUANTITY_TRACKED) return qtyBucketOf(a);
    return individualBucketOf(a);
  };

  // Pre-checkout bookings (DRAFT/RESERVED/CANCELLED): force every unit to
  // Booked, ignoring the global asset status that may belong to another
  // booking (main fix merged 2026-06-29). Skips main's `: isFinal ?
  // finalBucketOf : bucketOf` arm because HEAD's `bucketOf` is the QT-aware
  // dispatcher that already handles the isFinal case inside qtyBucketOf and
  // individualBucketOf — no separate finalBucketOf is defined here.
  const resolveBucket = isPreCheckout ? (): "booked" => "booked" : bucketOf;

  let booked = 0;
  let partial = 0;
  let checkedOut = 0;
  let returned = 0;

  /** Increment the running totals from a single bucket label. */
  const tally = (bucket: Bucket) => {
    if (bucket === "booked") booked += 1;
    else if (bucket === "partial") partial += 1;
    else if (bucket === "checkedOut") checkedOut += 1;
    else returned += 1;
  };

  if (!countKitsAsSingleUnit) {
    for (const a of bookingAssets) tally(resolveBucket(a));
  } else {
    // Standalone rows always bucket per-asset (no kit collapse to consider).
    for (const a of bookingAssets.filter((x) => x.kitId === null)) {
      tally(resolveBucket(a));
    }
    const kitGroups = new Map<string, LifecycleAsset[]>();
    for (const a of bookingAssets) {
      if (a.kitId === null) continue;
      const g = kitGroups.get(a.kitId);
      if (g) g.push(a);
      else kitGroups.set(a.kitId, [a]);
    }
    for (const group of kitGroups.values()) {
      const buckets = new Set(group.map(resolveBucket));
      // Any partial member promotes the whole kit to Partial — a kit with a
      // mid-flight QT member is itself mid-flight regardless of its peers.
      if (buckets.has("partial")) {
        tally("partial");
        continue;
      }
      // All members agree → that label collapses for the kit-unit.
      if (buckets.size === 1) {
        tally([...buckets][0]);
        continue;
      }
      // Members disagree across the remaining (non-partial) labels → Booked.
      tally("booked");
    }
  }

  // `totalUnits` is the number of ITEMS counted (assets in asset mode,
  // standalone assets + distinct kits in unit mode) — NOT a sum of physical
  // unit quantities. Each item contributes exactly one count to one bucket.
  const totalUnits = booked + partial + checkedOut + returned;

  if (isFinal) {
    // At COMPLETE/ARCHIVED the priority chain only emits Booked or Returned,
    // so `partial` and `checkedOut` are 0 here. Progress is derived from the
    // returned/booked split — never hard-coded to 100%.
    const checkoutProgressCount = partial + checkedOut + returned;
    const pctFinal = (n: number) =>
      totalUnits > 0 ? Math.round((n / totalUnits) * 100) : 0;

    return {
      totalUnits,
      bookedCount: booked,
      partialCount: partial,
      checkedOutCount: checkedOut,
      returnedCount: returned,
      checkoutProgressCount,
      checkoutProgressPercentage: pctFinal(checkoutProgressCount),
      checkinProgressCount: returned,
      checkinProgressPercentage: pctFinal(returned),
      hasPartialCheckouts: checkoutProgressCount > 0,
      hasPartialCheckins: returned > 0,
      countMode,
    };
  }

  const checkoutProgressCount = partial + checkedOut + returned;
  const pct = (n: number) =>
    totalUnits > 0 ? Math.round((n / totalUnits) * 100) : 0;

  return {
    totalUnits,
    bookedCount: booked,
    partialCount: partial,
    checkedOutCount: checkedOut,
    returnedCount: returned,
    checkoutProgressCount,
    checkoutProgressPercentage: pct(checkoutProgressCount),
    checkinProgressCount: returned,
    checkinProgressPercentage: pct(returned),
    hasPartialCheckouts: checkoutProgressCount > 0,
    hasPartialCheckins: returned > 0,
    countMode,
  };
}

/**
 * Determines if a booking page should redirect to apply appropriate status filters
 * Handles smart status param management for better UX
 */
export function getBookingStatusRedirect({
  bookingId,
  booking,
  currentStatusParam,
  isMainBookingPage,
}: {
  bookingId: string;
  booking: Pick<Booking, "id" | "status"> & {
    bookingAssets: { asset: Pick<Asset, "status"> }[];
  };
  currentStatusParam: string | null;
  isMainBookingPage: boolean;
}) {
  if (!isMainBookingPage) {
    return null;
  }

  // Case 1: ONGOING/OVERDUE booking with no status param
  // -> Redirect to CHECKED_OUT if there are assets to show
  if (!currentStatusParam && ["ONGOING", "OVERDUE"].includes(booking.status)) {
    const hasCheckedOutAssets = booking.bookingAssets.some(
      (ba) => ba.asset.status === AssetStatus.CHECKED_OUT
    );

    if (hasCheckedOutAssets) {
      return redirect(
        `/bookings/${bookingId}?status=${AssetStatus.CHECKED_OUT}`
      );
    }
    // If no CHECKED_OUT assets, let it show all assets (no redirect needed)
  }

  // Case 2: COMPLETE booking with CHECKED_OUT status param
  // -> Redirect to clean URL since CHECKED_OUT filter doesn't make sense anymore
  if (
    currentStatusParam === AssetStatus.CHECKED_OUT &&
    booking.status === BookingStatus.COMPLETE
  ) {
    return redirect(`/bookings/${bookingId}`);
  }

  // Case 3: All other cases - no redirect needed
  return null;
}

/**
 * Creates standardized booking conflict query conditions for the
 * `asset.bookingAssets` pivot relation. The conditions filter through
 * `BookingAsset` to the related `Booking`, matching the explicit M2M
 * schema (`BookingAsset { booking, asset, quantity }`).
 *
 * Previously this returned `Prisma.Asset$bookingsArgs` for the implicit
 * M2M. Now it returns `Prisma.Asset$bookingAssetsArgs` with the booking
 * conditions nested under `booking: { ... }`.
 */
export function createBookingConflictConditions({
  currentBookingId,
  fromDate,
  toDate,
  includeCurrentBooking = false,
}: {
  currentBookingId: string;
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
  includeCurrentBooking?: boolean;
}): Prisma.Asset$bookingAssetsArgs {
  /** Booking-level where clause for date-overlap & status filtering */
  const bookingWhere: Prisma.BookingWhereInput =
    fromDate && toDate
      ? {
          OR: [
            // Rule 1: RESERVED bookings always conflict
            {
              status: BookingStatus.RESERVED,
              ...(includeCurrentBooking
                ? {}
                : { id: { not: currentBookingId } }),
              OR: [
                {
                  from: { lte: toDate },
                  to: { gte: fromDate },
                },
                {
                  from: { gte: fromDate },
                  to: { lte: toDate },
                },
              ],
            },
            // Rule 2: ONGOING/OVERDUE bookings (filtered by asset status in helpers)
            {
              status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
              ...(includeCurrentBooking
                ? {}
                : { id: { not: currentBookingId } }),
              OR: [
                {
                  from: { lte: toDate },
                  to: { gte: fromDate },
                },
                {
                  from: { gte: fromDate },
                  to: { lte: toDate },
                },
              ],
            },
          ],
        }
      : {};

  return {
    where: {
      booking: bookingWhere,
    },
    select: {
      id: true,
      quantity: true,
      booking: {
        select: { id: true, status: true, name: true },
      },
    },
  };
}

/**
 * Normalizes BookingAsset pivot records into a flat asset array
 * with bonus booking quantity info. Used at the boundary between
 * the service layer and UI components for backward compatibility.
 */
export function normalizeBookingAssets<
  T extends { asset: Record<string, unknown>; quantity: number; id: string },
>(bookingAssets: T[]) {
  return bookingAssets.map((ba) => ({
    ...ba.asset,
    bookingQuantity: ba.quantity,
    bookingAssetId: ba.id,
  }));
}
