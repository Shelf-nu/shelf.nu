import {
  AssetStatus,
  AssetType,
  BookingStatus,
  OrganizationRoles,
} from "@prisma/client";
import type {
  Asset,
  Booking,
  Organization,
  Prisma,
  User,
} from "@prisma/client";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";

const label: ErrorLabel = "Booking";

/**
 * Restricts a bulk booking query to the rows the caller is allowed to act on.
 *
 * Mirrors `validateBookingOwnership`, the gate the SINGULAR write paths use:
 * a BASE or SELF_SERVICE caller may only act on bookings they created or hold
 * custody of. ADMIN and OWNER are unrestricted.
 *
 * Deliberately keyed on the ROLE, not on `canSeeAllBookings`. Those differ:
 * `selfServiceCanSeeBookings` / `baseUserCanSeeBookings` make the *list* show a
 * restricted user every booking in the workspace, but they do not grant write
 * access — singular delete still refuses. Scoping a destructive bulk action by
 * what the user can SEE would hand those workspaces org-wide deletion.
 *
 * Team-member custody links are intentionally absent, matching
 * `validateBookingOwnership`. The read path is wider (it also matches
 * `custodianTeamMemberId`), and that asymmetry is a known, separately tracked
 * inconsistency — widening it here would be a silent authorization change
 * bundled into a security fix.
 *
 * @param role - The caller's effective role in this organization
 * @param userId - The caller
 * @returns An ownership predicate, or `null` when the role is unrestricted
 */
export function getBookingOwnershipScope({
  role,
  userId,
}: {
  role: OrganizationRoles;
  /** Absent for system-initiated calls, which have no acting user */
  userId?: User["id"];
}): Prisma.BookingWhereInput | null {
  /**
   * ALLOW-list, not a deny-list on SELF_SERVICE/BASE. A role added to
   * `OrganizationRoles` later lands in the RESTRICTED branch by default, so it
   * gets scoped to its own rows rather than silently inheriting org-wide
   * delete. Matches `bookingWriteScopeClause`, which is the other query-side
   * clause and documents the same reasoning; the submit-time gate
   * (`validateBookingOwnership`) deny-lists by deliberate, separate design.
   */
  const canActOnEveryBooking =
    role === OrganizationRoles.ADMIN || role === OrganizationRoles.OWNER;

  if (canActOnEveryBooking) {
    return null;
  }

  if (!userId) {
    /**
     * A restricted role with nobody to scope to. Returning `null` here would
     * silently hand the caller every booking in the workspace, so fail closed:
     * this can only be a wiring mistake, and it must not degrade into an
     * org-wide destructive query.
     */
    throw new ShelfError({
      cause: null,
      message:
        "Cannot resolve which bookings this user may act on. Please contact support.",
      additionalData: { role },
      label,
    });
  }

  return { OR: [{ creatorId: userId }, { custodianUserId: userId }] };
}

/**
 * Builds the complete `where` for a bulk booking action.
 *
 * Shared by `bulkDeleteBookings`, `bulkArchiveBookings` and
 * `bulkCancelBookings` so the three cannot drift — and so the ownership scope
 * cannot be forgotten on one of them.
 *
 * The ownership predicate is AND-ed onto BOTH branches on purpose. Applying it
 * only to "select all" would still let a restricted caller act on someone
 * else's booking by posting its id directly.
 *
 * @param bookingIds - Explicit ids, or `[ALL_SELECTED_KEY]` for select-all
 * @param organizationId - The caller's (validated) organization
 * @param currentSearchParams - The list filters, for the select-all branch
 * @param role - The caller's effective role
 * @param userId - The caller
 * @returns A `Prisma.BookingWhereInput` scoped to org, filters and ownership
 */
export function getBulkBookingsWhereInput({
  bookingIds,
  organizationId,
  currentSearchParams,
  role,
  userId,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
  role: OrganizationRoles;
  /** Absent for system-initiated calls, which have no acting user */
  userId?: User["id"];
}): Prisma.BookingWhereInput {
  const base: Prisma.BookingWhereInput = bookingIds.includes(ALL_SELECTED_KEY)
    ? getBookingWhereInput({ currentSearchParams, organizationId })
    : { id: { in: bookingIds }, organizationId };

  const ownership = getBookingOwnershipScope({ role, userId });

  if (!ownership) {
    return base;
  }

  // AND rather than a spread: `base` may carry its own OR, and merging the two
  // would union them — widening a destructive action instead of narrowing it.
  return { AND: [base, ownership] };
}

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

/**
 * Booking statuses in which the booking is a CLOSED record.
 *
 * A closed booking is history: its assets have been returned (COMPLETE), the
 * reservation was called off (CANCELLED), or it has been filed away
 * (ARCHIVED). Nothing about it may change afterwards, or the audit trail stops
 * describing what actually happened.
 *
 * This is the same set `canUserRemoveBookingAssets` treats as closed and the
 * inverse of `ADDABLE_BOOKING_STATUSES` — kept in one place so the server-side
 * assertions below cannot drift from the client-side affordances.
 *
 * @see {@link file://./../../utils/bookings.ts} `canUserRemoveBookingAssets`
 * @see {@link file://./constants.ts} `ADDABLE_BOOKING_STATUSES`
 */
export const CLOSED_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETE,
  BookingStatus.ARCHIVED,
  BookingStatus.CANCELLED,
];

/**
 * Statuses in which a booking is physically in flight — its assets are out
 * with a custodian right now. Only these can be checked back in.
 */
export const IN_FLIGHT_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Refuses a mutation against a booking that is already closed.
 *
 * Call this from the SERVICE layer, inside the same transaction as the write,
 * reading the status from a row loaded in that transaction. Routes checking
 * the status themselves is not equivalent, for two reasons:
 *
 * 1. A route that forgets is simply unguarded. The scan-assets action had no
 *    status check of any kind, so a direct POST could add assets to a
 *    COMPLETE booking; its loader computed `canUserManageBookingAssets`, but
 *    that only decided what to RENDER.
 * 2. A route that checks before calling the service leaves a window open. The
 *    four `updateBookingAssets` callers all validated the status, but each did
 *    so in a read of its own — so a booking completed in between was still
 *    written to. Reading inside the write's transaction closes that window by
 *    construction rather than by narrowing it.
 *
 * @param status - The booking's current status, read inside the transaction
 * @param operation - Verb phrase for the message, e.g. "add items to"
 * @param bookingId - Included in `additionalData` for debugging
 * @throws {ShelfError} 400 when the booking is COMPLETE, ARCHIVED or CANCELLED
 */
export function assertBookingIsOpen({
  status,
  operation,
  bookingId,
}: {
  status: BookingStatus;
  operation: string;
  bookingId: Booking["id"];
}): void {
  if (CLOSED_BOOKING_STATUSES.includes(status)) {
    throw new ShelfError({
      cause: null,
      message: `You cannot ${operation} a booking that is ${status.toLowerCase()}. Completed, archived and cancelled bookings are closed records and can no longer be changed.`,
      additionalData: { bookingId, status },
      label,
      status: 400,
      // User-input class, not a server fault: a stale tab whose booking was
      // completed elsewhere lands here legitimately.
      shouldBeCaptured: false,
    });
  }
}

/**
 * Refuses a check-in against a booking that was never checked out.
 *
 * `checkinBooking` writes `status: COMPLETE` unconditionally, so without this
 * a direct POST against a DRAFT or RESERVED booking marked it COMPLETE while
 * checking in nothing — the asset filter drops every asset that is not
 * CHECKED_OUT, which for those statuses is all of them. The result is a
 * booking that reads as finished but never happened.
 *
 * @param status - The booking's current status, read inside the transaction
 * @param bookingId - Included in `additionalData` for debugging
 * @throws {ShelfError} 400 unless the booking is ONGOING or OVERDUE
 */
export function assertBookingIsCheckinable({
  status,
  bookingId,
}: {
  status: BookingStatus;
  bookingId: Booking["id"];
}): void {
  if (!IN_FLIGHT_BOOKING_STATUSES.includes(status)) {
    throw new ShelfError({
      cause: null,
      message: `You cannot check in a booking that is ${status.toLowerCase()}. Only ongoing or overdue bookings — the ones whose assets are actually out — can be checked in.`,
      additionalData: { bookingId, status },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Takes a row-level lock on a booking, then returns its status.
 *
 * **Must be called inside a `db.$transaction()` interactive transaction**, and
 * before any write that depends on the booking still being in a given status.
 *
 * A plain `SELECT` inside a transaction is NOT enough. Under PostgreSQL's
 * default READ COMMITTED isolation it takes no lock, so a concurrent check-in,
 * archive or cancellation can commit between the read and the write and this
 * transaction still succeeds — mutating a booking that is closed by the time
 * it commits. Reading inside the transaction narrows that window; only the
 * lock closes it.
 *
 * The predicate is **org-scoped**, matching `lockAssetForQuantityUpdate`: a
 * caller passing a foreign-org booking id matches zero rows, so it takes no
 * lock and learns nothing about whether the id exists. Locking on `id` alone
 * would hand an attacker a cross-tenant lock oracle and a contention vector.
 *
 * @param tx - Prisma interactive transaction client
 * @param bookingId - Booking to lock
 * @param organizationId - Caller's validated organization; scopes the lock
 * @returns The locked booking's current status
 * @throws {ShelfError} 404 when the booking is missing or cross-org
 * @see {@link file://./../consumption-log/quantity-lock.server.ts} the asset equivalent
 */
export async function lockBookingForStatusCheck(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, // Prisma interactive tx client (no clean type for extended clients)
  bookingId: Booking["id"],
  organizationId: Booking["organizationId"]
): Promise<BookingStatus> {
  // `Booking.status` carries no `@map`, so the Prisma field name IS the column
  // name here — checked against the schema, per the raw-SQL rule.
  const rows = await tx.$queryRaw<{ status: BookingStatus }[]>`
    SELECT status FROM "Booking" WHERE id = ${bookingId} AND "organizationId" = ${organizationId} FOR UPDATE
  `;

  if (!rows || rows.length === 0) {
    throw new ShelfError({
      cause: null,
      message: "Booking not found",
      additionalData: { bookingId, organizationId },
      label,
      status: 404,
    });
  }

  return rows[0].status;
}
