import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { addMinutes, isAfter, isBefore, subMinutes } from "date-fns";
import { ONE_DAY, ONE_HOUR } from "~/utils/constants";
import { getPrimaryLocation } from "../asset/utils";

type AssetWithKit = {
  id: string;
  title: string;
  status: string;
  kitId: string | null;
  kit: { name: string; location?: { name: string } | null } | null;
  category: { name: string } | null;
  location?: { name: string } | null;
  [key: string]: unknown;
};

/**
 * Options controlling {@link groupAndSortAssetsByKit}.
 */
export type GroupAndSortOptions<T> = {
  /**
   * Predicate deciding whether an asset counts as "checked out" for the Status
   * sort's bottom bucket. Defaults to a raw `status === "CHECKED_OUT"` check
   * (used by the PDF export). The booking overview injects a booking-context
   * aware predicate so QT DRAFT/RESERVED rows and partially-checked-in assets
   * stay in the actionable (top) bucket.
   */
  isCheckedOut?: (asset: T) => boolean;
};

/** Normalized sort key for a single sortable unit (a kit or a standalone asset). */
type SortDescriptor = {
  name: string;
  category: string | null;
  location: string | null;
  checkedOut: boolean;
  isKit: boolean;
};

/**
 * Compares two sort descriptors for the given field/direction.
 *
 * Rules shared by kit-units and asset-units:
 * - `category`/`location` nulls always sort last, regardless of direction.
 * - Every field falls back to a case-insensitive A→Z name tiebreak, so ordering
 *   is deterministic and stable.
 * - `status`: not-checked-out (top) vs checked-out (bottom); `desc` keeps
 *   actionable items on top, `asc` swaps the buckets.
 * - `type`: kits (top) vs assets (bottom); `desc` keeps kits first, `asc` swaps.
 */
function compareSortDescriptors(
  a: SortDescriptor,
  b: SortDescriptor,
  orderBy: string,
  orderDirection: "asc" | "desc"
): number {
  const dirMul = orderDirection === "asc" ? 1 : -1;
  // Case-insensitive comparator so the A→Z tiebreak matches the documented
  // contract regardless of runtime/locale default sensitivity.
  const compareText = (left: string, right: string) =>
    left.localeCompare(right, undefined, { sensitivity: "base" });
  const byName = () => compareText(a.name, b.name);

  switch (orderBy) {
    case "title":
      return dirMul * compareText(a.name, b.name);

    case "category": {
      if (!a.category && b.category) return 1;
      if (a.category && !b.category) return -1;
      if (!a.category && !b.category) return byName();
      return dirMul * compareText(a.category!, b.category!) || byName();
    }

    case "location": {
      if (!a.location && b.location) return 1;
      if (a.location && !b.location) return -1;
      if (!a.location && !b.location) return byName();
      return dirMul * compareText(a.location!, b.location!) || byName();
    }

    case "type": {
      // Kits (0) before assets (1) when desc; reversed when asc.
      const bucketA = a.isKit ? 0 : 1;
      const bucketB = b.isKit ? 0 : 1;
      const typeMul = orderDirection === "desc" ? 1 : -1;
      return typeMul * (bucketA - bucketB) || byName();
    }

    case "status":
    default: {
      // Not-checked-out (0) on top, checked-out (1) at the bottom when desc;
      // reversed when asc. Secondary A→Z by name.
      const bucketA = a.checkedOut ? 1 : 0;
      const bucketB = b.checkedOut ? 1 : 0;
      const statusMul = orderDirection === "desc" ? 1 : -1;
      return statusMul * (bucketA - bucketB) || byName();
    }
  }
}

/**
 * Orders a booking's assets for display, treating each kit as a single sortable
 * unit that competes with standalone assets by the chosen field. Kits stay
 * visually grouped (their members are emitted contiguously), but they are no
 * longer force-pinned above standalone assets — except for the `type` sort,
 * which explicitly groups kits first then assets.
 *
 * Preserves the flat-in / flat-out contract: callers pass a flat asset array
 * and receive a flat array in which each kit's members are adjacent at the
 * kit's sorted position. `shapeBookingAssets` and the PDF export both rely on
 * this.
 *
 * @param assets - Flat array of enriched booking assets (kit members included).
 * @param orderBy - Sort field: `status` | `title` | `category` | `location` | `type`.
 * @param orderDirection - `asc` or `desc`.
 * @param options - See {@link GroupAndSortOptions}; `isCheckedOut` customizes
 *   the Status sort's checked-out determination.
 * @returns The flat, ordered asset array with kit members kept contiguous.
 */
export function groupAndSortAssetsByKit<T extends AssetWithKit>(
  assets: T[],
  orderBy: string = "status",
  orderDirection: "asc" | "desc" = "desc",
  options: GroupAndSortOptions<T> = {}
): T[] {
  const isCheckedOut =
    options.isCheckedOut ?? ((asset: T) => asset.status === "CHECKED_OUT");

  // Partition into kit groups (preserving first-seen order) and standalones.
  const kitOrder: string[] = [];
  const kitGroups = new Map<string, T[]>();
  const individualAssets: T[] = [];

  for (const asset of assets) {
    if (asset.kitId && asset.kit) {
      if (!kitGroups.has(asset.kitId)) {
        kitGroups.set(asset.kitId, []);
        kitOrder.push(asset.kitId);
      }
      kitGroups.get(asset.kitId)!.push(asset);
    } else {
      individualAssets.push(asset);
    }
  }

  // Descriptor for a standalone asset (also used to order members inside a kit).
  const assetDescriptor = (asset: T): SortDescriptor => ({
    name: asset.title,
    category: asset.category?.name ?? null,
    location: asset.location?.name ?? null,
    checkedOut: isCheckedOut(asset),
    isKit: false,
  });

  const compareAssets = (a: T, b: T) =>
    compareSortDescriptors(
      assetDescriptor(a),
      assetDescriptor(b),
      orderBy,
      orderDirection
    );

  // Sort members within each kit so they render in the chosen order and the
  // first member is a valid representative for the kit's category value.
  for (const members of kitGroups.values()) {
    members.sort(compareAssets);
  }

  // Build the sortable units: one per kit, one per standalone asset.
  type Unit = { descriptor: SortDescriptor; members: T[] };
  const units: Unit[] = [];

  for (const kitId of kitOrder) {
    const members = kitGroups.get(kitId)!;
    const first = members[0];
    units.push({
      members,
      descriptor: {
        name: first.kit!.name,
        // Representative category = first (already field-sorted) member's.
        category: first.category?.name ?? null,
        // Kit's own location, falling back to the first member's location.
        location: first.kit!.location?.name ?? first.location?.name ?? null,
        // A kit sinks to the checked-out bucket only when ALL members are out.
        checkedOut: members.every((m) => isCheckedOut(m)),
        isKit: true,
      },
    });
  }

  for (const asset of individualAssets) {
    units.push({ members: [asset], descriptor: assetDescriptor(asset) });
  }

  // Sort the units, then flatten — each kit's members stay contiguous.
  units.sort((a, b) =>
    compareSortDescriptors(a.descriptor, b.descriptor, orderBy, orderDirection)
  );

  const result: T[] = [];
  for (const unit of units) {
    result.push(...unit.members);
  }
  return result;
}

/**
 * This function checks if the booking is being early checkout.
 * It only considers it early if it's more than 15 minutes before the booking start time.
 */
export function isBookingEarlyCheckout(from: Date): boolean {
  const now = new Date();
  const fromWithBuffer = subMinutes(from, 15);
  return isAfter(fromWithBuffer, now);
}

/**
 * Decide whether a checkout should show the early-checkout "adjust start date"
 * prompt. This is ONLY appropriate for the first checkout that transitions the
 * booking RESERVED → ONGOING: adjusting the start date once the booking has
 * already started is meaningless, and `partialCheckoutBooking` ignores the date
 * choice unless the booking is RESERVED. Used by the scanner drawer and the
 * bulk partial-checkout dialog so a progressive checkout of remaining items on
 * an ONGOING/OVERDUE booking never re-prompts.
 *
 * @param status - The booking's current status
 * @param from - The booking's start date
 * @returns `true` only when the booking is RESERVED and starts >15min from now
 */
export function shouldPromptEarlyCheckout(
  status: BookingStatus,
  from: Date
): boolean {
  return status === BookingStatus.RESERVED && isBookingEarlyCheckout(from);
}

/**
 * Minimal asset shape needed to decide check-out eligibility. `type` drives
 * the QT-vs-INDIVIDUAL branch in {@link isAssetCheckoutEligible}; legacy
 * callers that omit it fall through to INDIVIDUAL semantics.
 */
type CheckoutEligibilityAsset = {
  id: string;
  status: AssetStatus;
  type?: AssetType;
};

/**
 * Decide whether a booking asset is still eligible to be checked out right now.
 *
 * An asset is eligible when it has NOT already left the "Booked" bucket and can
 * physically be checked out. Specifically it must not be:
 * - already checked out — by a partial-checkout record (`checkedOutIds`) OR a
 *   live `CHECKED_OUT` status (the all-at-once flow leaves no record);
 * - already returned via partial check-in (`returnedIds`) — those are AVAILABLE
 *   again but DONE for this booking;
 * - in custody (must be released before it can be checked out).
 *
 * QUANTITY_TRACKED assets are partial top-off aware: when a per-asset
 * `remainingByAssetId` map is supplied, eligibility is "remaining > 0" (a QT
 * asset with 2 of 5 units already out is still eligible for the other 3).
 * Without the map the helper preserves the legacy binary gate so existing
 * callers behave unchanged.
 *
 * Shared by the scanner drawer's eligibility filter and its "remaining to check
 * out" denominator so the numerator and denominator always describe the SAME
 * set (the progress bar can reach 100%).
 *
 * @param asset - The asset (id + live status + optional type)
 * @param checkedOutIds - Set of asset ids already checked out for this booking
 * @param returnedIds - Set of asset ids already returned via partial check-in
 * @param remainingByAssetId - Optional QT-aware per-asset remaining-unit map;
 *   when present, QT assets are eligible iff `remaining > 0`
 * @returns `true` when the asset can still be scanned out
 */
export function isAssetCheckoutEligible(
  asset: CheckoutEligibilityAsset,
  checkedOutIds: Set<string>,
  returnedIds: Set<string>,
  remainingByAssetId?: Record<string, number>
): boolean {
  if (returnedIds.has(asset.id)) return false;
  if (asset.status === AssetStatus.IN_CUSTODY) return false;
  // QUANTITY_TRACKED: eligibility is per-unit when the loader supplies a
  // value for the asset (top-off-aware path). The asset has remaining
  // units exactly when remaining > 0. Status CHECKED_OUT for QT implies
  // remaining === 0 (status flips when every slice is claimed), so the
  // remaining gate is sufficient. When the map is absent OR the asset has
  // no entry (legacy callsites, older tests), fall back to the binary
  // gate so behaviour is unchanged.
  if (asset.type === AssetType.QUANTITY_TRACKED) {
    if (remainingByAssetId && asset.id in remainingByAssetId) {
      return (remainingByAssetId[asset.id] ?? 0) > 0;
    }
    // Legacy / unmapped: preserve current behaviour (binary).
    return (
      !checkedOutIds.has(asset.id) && asset.status !== AssetStatus.CHECKED_OUT
    );
  }
  // INDIVIDUAL: unchanged binary gate.
  return (
    !checkedOutIds.has(asset.id) && asset.status !== AssetStatus.CHECKED_OUT
  );
}

/**
 * Count the booking assets still available to check out — the scanner's
 * "remaining to check out" denominator. Asset-scoped (kit assets counted
 * individually) and uses {@link isAssetCheckoutEligible}, so it stays in lock
 * step with the scanner's eligibility filter.
 *
 * For QUANTITY_TRACKED assets the meaning is "unique assets with remaining
 * units > 0" — a QT asset with any remaining quantity counts as 1 toward the
 * denominator, never as its remaining-unit count. INDIVIDUAL assets still
 * contribute 1. The scanner's progress bar stays asset-scoped, which matches
 * the existing UI semantics.
 *
 * @param bookingAssets - All assets on the booking (id + live status + optional type)
 * @param checkedOutAssetIds - Asset ids already checked out (record or status)
 * @param checkedInAssetIds - Asset ids already returned via partial check-in
 * @param remainingByAssetId - Optional QT-aware per-asset remaining-unit map
 *   forwarded to {@link isAssetCheckoutEligible}
 * @returns Number of assets still eligible to be checked out
 */
export function countRemainingCheckoutAssets(
  bookingAssets: CheckoutEligibilityAsset[],
  checkedOutAssetIds: string[],
  checkedInAssetIds: string[],
  remainingByAssetId?: Record<string, number>
): number {
  const checkedOutIds = new Set(checkedOutAssetIds);
  const returnedIds = new Set(checkedInAssetIds);
  return bookingAssets.filter((asset) =>
    isAssetCheckoutEligible(
      asset,
      checkedOutIds,
      returnedIds,
      remainingByAssetId
    )
  ).length;
}

/**
 * This function checks if the booking is being early checkin.
 * It only considers it early if it's more than 15 minutes before the booking end time.
 */
export function isBookingEarlyCheckin(to: Date) {
  const nowWithBuffer = addMinutes(new Date(), 15);
  return isBefore(nowWithBuffer, to);
}

// Calculate and format booking duration
export function formatBookingDuration(from: Date, to: Date): string {
  const start = new Date(from);
  const end = new Date(to);

  // Calculate duration in milliseconds
  const durationMs = end.getTime() - start.getTime();

  // Convert to days, hours, minutes
  const days = Math.floor(durationMs / ONE_DAY);
  const hours = Math.floor((durationMs % ONE_DAY) / ONE_HOUR);
  const minutes = Math.floor((durationMs % ONE_HOUR) / (1000 * 60));

  // Format the duration string
  let durationStr = "";

  if (days > 0) {
    durationStr += `${days} day${days !== 1 ? "s" : ""}`;
  }

  if (hours > 0) {
    durationStr += durationStr ? " · " : "";
    durationStr += `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  if (minutes > 0 || (days === 0 && hours === 0)) {
    durationStr += durationStr ? " · " : "";
    durationStr += `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  return durationStr;
}

/**
 * Whether a booking is eligible to be archived.
 *
 * Two cases qualify:
 * - `COMPLETE` bookings — the classic path, where the gear was checked back in.
 * - `RESERVED` bookings whose end date (`to`) has already passed. These are
 *   reservations that were never checked out, so archiving just files them
 *   away; their assets are already `AVAILABLE` and nothing gets orphaned.
 *
 * `ONGOING` / `OVERDUE` are deliberately excluded: their assets are physically
 * `CHECKED_OUT`, so archiving would hide the booking while leaving the gear
 * checked out with no active booking. `DRAFT`, `CANCELLED`, and future-dated
 * `RESERVED` bookings are not archivable either.
 *
 * Pure and dependency-light so the same rule gates both the server mutation and
 * the client-side UI affordance — no drift between them.
 *
 * @param status - The booking's current status.
 * @param to - The booking's scheduled end date.
 * @returns `true` if the booking may be archived.
 */
export function isBookingArchivable({
  status,
  to,
}: {
  status: BookingStatus;
  to: Date | string | null;
}): boolean {
  if (status === BookingStatus.COMPLETE) {
    return true;
  }

  if (status === BookingStatus.RESERVED && to != null) {
    return isBefore(new Date(to), new Date());
  }

  return false;
}

/**
 * Whether a booking in this status outranks an overlapping RESERVED booking
 * when competing for the same asset.
 *
 * An ONGOING/OVERDUE booking is physically in flight: its custodian is holding
 * (or collecting) the assets right now. A RESERVED booking has taken nothing —
 * it is a claim on the future. So the in-flight booking wins, and the loser is
 * told at ITS check-out, where `hasAssetBookingConflicts` correctly reports the
 * asset as CHECKED_OUT on an in-flight booking.
 *
 * Without this asymmetry the priority inverts: because an ONGOING booking does
 * not "occupy" an asset it has not yet checked out, anyone could reserve that
 * asset afterwards — and that later reservation would then permanently block
 * the in-flight booking from checking out an asset it already holds.
 *
 * @param status - The booking's current status
 * @returns `true` when the booking is in flight (ONGOING or OVERDUE)
 */
export function outranksReservations(status: string): boolean {
  return status === BookingStatus.ONGOING || status === BookingStatus.OVERDUE;
}

/**
 * Core logic for determining if an asset has booking conflicts.
 * Assets now reference bookings through the BookingAsset pivot table,
 * so we traverse `asset.bookingAssets[].booking` instead of the
 * old implicit `asset.bookings[]`.
 *
 * For INDIVIDUAL assets, any overlapping booking is a conflict.
 * For QUANTITY_TRACKED assets, this function always returns false because
 * multiple bookings can reserve from the same asset as long as the total
 * reserved quantity does not exceed the available quantity. The actual
 * quantity availability check is performed at the service layer via
 * `computeBookingAvailableQuantity()`.
 *
 * Used by both isAssetAlreadyBooked and kit-related functions.
 *
 * @param asset - Minimal asset shape (status, type, pivot rows to bookings)
 * @param currentBookingId - Booking being evaluated; its own rows never conflict
 * @param options.ignoreReservedConflicts - Drop the "RESERVED always conflicts"
 *   rule. Pass this ONLY when the current booking is itself already in flight
 *   (ONGOING/OVERDUE) — see {@link outranksReservations}.
 */
export function hasAssetBookingConflicts(
  asset: {
    status: string;
    type?: string;
    bookingAssets?: { booking: { id: string; status: string } }[];
  },
  currentBookingId: string,
  options?: { ignoreReservedConflicts?: boolean }
): boolean {
  /**
   * QUANTITY_TRACKED assets can appear in multiple concurrent bookings,
   * each reserving a portion of the total quantity. Conflict detection
   * for these assets is handled at the service layer where we have access
   * to the full quantity context (total, in-custody, reserved amounts).
   */
  if (asset.type === AssetType.QUANTITY_TRACKED) return false;

  if (!asset.bookingAssets?.length) return false;

  const conflictingBookings = asset.bookingAssets
    .map((ba) => ba.booking)
    .filter((b) => b.id !== currentBookingId);

  if (conflictingBookings.length === 0) return false;

  // Check if any conflicting booking is RESERVED (always conflicts).
  // `ignoreReservedConflicts` suppresses this rule for callers whose own
  // booking already outranks a reservation — a reservation has taken nothing
  // yet, so it must not block a booking that is physically in flight.
  const hasReservedConflict =
    !options?.ignoreReservedConflicts &&
    conflictingBookings.some((b) => b.status === BookingStatus.RESERVED);

  if (hasReservedConflict) return true;

  // For ONGOING/OVERDUE bookings, only conflict if asset is actually CHECKED_OUT
  const hasOngoingConflict = conflictingBookings.some(
    (b) =>
      (b.status === BookingStatus.ONGOING ||
        b.status === BookingStatus.OVERDUE) &&
      asset.status === AssetStatus.CHECKED_OUT
  );

  return hasOngoingConflict;
}

/**
 * Determines if an asset is already booked and unavailable for the current booking context.
 * Handles partial check-in logic properly.
 *
 * For QUANTITY_TRACKED assets, this always returns false because they support
 * concurrent bookings — quantity availability is validated at the service layer.
 *
 * Uses the BookingAsset pivot relation (`asset.bookingAssets[].booking`)
 * instead of the removed implicit `asset.bookings[]`.
 */
export function isAssetAlreadyBooked(
  asset: {
    status: string;
    type?: string;
    bookingAssets?: { booking: { id: string; status: string } }[];
  },
  currentBookingId: string
): boolean {
  return hasAssetBookingConflicts(asset, currentBookingId);
}

/**
 * Minimal asset shape needed for in-memory booking search. Mirrors the fields
 * selected by `BOOKING_WITH_ASSETS_INCLUDE.assets.select`. Relation fields are
 * optional/nullable to allow structural subtyping against the richer Prisma
 * asset payload.
 *
 * @see {@link file://./constants.ts} BOOKING_WITH_ASSETS_INCLUDE.assets.select
 */
export type SearchableBookingAsset = {
  id: string;
  kitId: string | null;
  title: string;
  sequentialId?: string | null;
  category?: { name: string } | null;
  tags?: { name: string }[] | null;
  location?: { name: string } | null;
  qrCodes?: { id: string }[] | null;
  barcodes?: { value: string }[] | null;
  kit?: {
    name?: string | null;
    location?: { name: string } | null;
    category?: { name: string } | null;
  } | null;
};

/**
 * Splits a raw search string into lowercased, trimmed, non-empty terms.
 * Commas separate terms (comma = OR).
 *
 * @param search - Raw search string from the `s` query param
 * @returns Array of normalized terms (empty if the input is blank)
 */
function parseBookingSearchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .trim()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * True when `term` is a case-insensitive substring of any searchable field of
 * the asset (its own fields, its tags/codes, or its kit's fields).
 *
 * @param asset - The asset to test
 * @param term - An already-lowercased search term
 */
function assetMatchesBookingTerm(
  asset: SearchableBookingAsset,
  term: string
): boolean {
  const haystacks: (string | null | undefined)[] = [
    asset.title,
    asset.sequentialId,
    asset.category?.name,
    asset.location?.name,
    asset.kit?.name,
    asset.kit?.location?.name,
    asset.kit?.category?.name,
    ...(asset.tags?.map((tag) => tag.name) ?? []),
    ...(asset.qrCodes?.map((qr) => qr.id) ?? []),
    ...(asset.barcodes?.map((barcode) => barcode.value) ?? []),
  ];

  return haystacks.some(
    (value) => value != null && value.toLowerCase().includes(term)
  );
}

/**
 * In-memory replacement for the old Prisma multi-relation `OR` search on a
 * booking's assets. An asset matches if ANY comma-separated term is a
 * case-insensitive substring of ANY of its searchable fields. A match inside a
 * kit re-expands to surface the ENTIRE kit (all sibling assets).
 *
 * Input order is preserved (callers sort afterwards). Blank/missing search
 * returns the input array unchanged.
 *
 * @param assets - The booking's full asset list
 * @param search - Raw search string from the `s` query param (may be blank)
 * @returns The filtered subset (with kits re-expanded)
 */
export function filterBookingAssets<T extends SearchableBookingAsset>(
  assets: T[],
  search: string | null | undefined
): T[] {
  const terms = search ? parseBookingSearchTerms(search) : [];
  if (terms.length === 0) {
    return assets;
  }

  // Comma = OR: an asset matches if any term matches any of its fields.
  const directMatches = assets.filter((asset) =>
    terms.some((term) => assetMatchesBookingTerm(asset, term))
  );

  // Kit re-expansion: a matched asset surfaces its whole kit.
  const matchedKitIds = new Set(
    directMatches
      .map((asset) => asset.kitId)
      .filter((kitId): kitId is string => Boolean(kitId))
  );
  if (matchedKitIds.size === 0) {
    return directMatches;
  }

  const directIds = new Set(directMatches.map((asset) => asset.id));
  return assets.filter(
    (asset) =>
      directIds.has(asset.id) ||
      (asset.kitId != null && matchedKitIds.has(asset.kitId))
  );
}

/**
 * A single search-visible `BookingAsset` slice, reduced to the fields the PDF
 * per-slice row builder needs.
 *
 * One QUANTITY_TRACKED asset can contribute several slices to a single booking
 * (one standalone / free-pool slice plus one per kit it is booked under), and
 * the exported PDF renders EACH slice as its own row — so a slice must carry
 * its own booked quantity and a unique key, not be collapsed into one asset row.
 */
export type PdfBookingAssetSlice = {
  /** The asset id. Shared across a QT asset's multiple slices. */
  id: string;
  /**
   * The slice's `BookingAsset.assetKitId`: `null` for a standalone (free-pool)
   * slice, otherwise the `AssetKit.id` (a MEMBERSHIP row id, NOT a `Kit.id`)
   * this slice was booked under. Matched against `assetKits[].id` on the
   * joined asset to resolve the slice's kit.
   *
   * Named `assetKitId` — not `kitId` — because {@link PdfSliceOverrides.kitId}
   * on the produced row holds a real `Kit.id`; the two were previously
   * indistinguishable by name. A QT asset in two kits has two slices with
   * the SAME asset id but different `assetKitId`s and different `kitId`s.
   */
  assetKitId: string | null;
  /**
   * The slice's `BookingAsset.sourceKitId`: the `Kit` this slice was booked
   * under, recorded durably. Unlike `assetKitId` it survives the asset leaving
   * the kit, so it is the fallback that keeps detached residue rendering under
   * its original kit instead of degrading to a loose asset row.
   */
  sourceKitId: string | null;
  /** Booked units for THIS slice (`BookingAsset.quantity`). */
  quantity: number;
  /** Unique `BookingAsset.id`, used as the rendered row's React key. */
  bookingAssetId: string;
};

/**
 * Minimal shape of the full per-asset data joined onto each slice. `assetKits`
 * carries each membership's `AssetKit.id` so a slice's `assetKitId` can be
 * resolved to the specific kit (name + location) it was booked under — a QT
 * asset can belong to several kits, so `assetKits[0]` is NOT necessarily right.
 */
type PdfRawAssetShape = {
  id: string;
  assetKits: Array<{
    /** `AssetKit.id` — matched against a slice's `assetKitId`. */
    id: string;
    kit: {
      id: string;
      name: string;
      location: { name: string } | null;
    } | null;
  }>;
  assetLocations?: Array<{ location?: { name: string } | null }>;
};

/**
 * A kit resolved from `BookingAsset.sourceKitId` rather than from a live
 * `AssetKit` membership — the snapshot of a kit whose members have since
 * changed. Deliberately the same shape a live membership's `kit` has, so both
 * resolution paths produce identical rows.
 */
export type PdfSnapshotKit = {
  id: string;
  name: string;
  location: { name: string } | null;
};

/** The resolved kit + location + slice metadata layered onto each raw asset. */
type PdfSliceOverrides = {
  /** The resolved kit's id (a `Kit.id`), or `null` for a standalone slice. */
  kitId: string | null;
  kit: {
    id: string;
    name: string;
    location: { name: string } | null;
  } | null;
  location: { name: string } | null;
  /** THIS slice's booked units. */
  quantity: number;
  /** Unique React key for the rendered row. */
  bookingAssetId: string;
};

/**
 * Builds the booking PDF's render list as ONE ROW PER `BookingAsset` slice
 * (mirroring the on-screen booking overview), rather than one deduped row per
 * asset.
 *
 * A QUANTITY_TRACKED asset booked as 4 standalone + 3 via Kit B1 + 3 via Kit B2
 * yields THREE rows — each carrying its own booked `quantity` and its own kit —
 * so the reader sees exactly which units belong to which kit. `groupAndSortAssetsByKit`
 * then groups these rows by their resolved `kitId` (never collapsing duplicate
 * asset ids), keeping each kit's slices contiguous.
 *
 * The join is done by asset id: `rawAssetsById` holds the full (deduped) asset
 * payload, and each slice's kit is resolved by matching the slice's
 * `assetKitId` (a `BookingAsset.assetKitId`) against the asset's
 * `assetKits[].id`. A slice whose asset didn't resolve is skipped defensively
 * rather than crashing — it cannot normally happen, since the visible slices
 * are the source of the asset ids fetched into `rawAssetsById`.
 *
 * When that membership is gone (the asset was removed from the kit, which
 * `SET NULL`s `assetKitId`), the slice falls back to its durable
 * `sourceKitId` via `snapshotKitsById`. Without it a finished booking's PDF
 * would retroactively re-describe the job as containing loose assets.
 *
 * @param visibleSlices - The search-visible, per-slice `BookingAsset` list
 *   (each already reduced to {@link PdfBookingAssetSlice}).
 * @param rawAssetsById - Full per-asset data keyed by asset id (deduped fetch).
 * @param snapshotKitsById - Org-scoped kits keyed by `Kit.id`, used only to
 *   resolve slices whose live membership is gone. Omit when no slice can be
 *   detached residue.
 * @returns One row per slice: the full asset data plus the slice's resolved
 *   kit, primary location, booked quantity and unique key.
 */
export function buildPdfAssetRows<TRaw extends PdfRawAssetShape>(
  visibleSlices: PdfBookingAssetSlice[],
  rawAssetsById: Map<string, TRaw>,
  snapshotKitsById: Map<string, PdfSnapshotKit> = new Map()
): Array<TRaw & PdfSliceOverrides> {
  const rows: Array<TRaw & PdfSliceOverrides> = [];

  for (const slice of visibleSlices) {
    const raw = rawAssetsById.get(slice.id);
    // Defensive: a slice whose asset didn't resolve is dropped, not crashed.
    if (!raw) {
      continue;
    }

    // Resolve THIS slice's kit (with location) from the full asset data. A
    // standalone slice (`assetKitId === null`) has no live membership; a
    // kit-driven slice matches its `AssetKit.id` against the asset's
    // memberships. Detached residue (membership gone, `sourceKitId` kept)
    // falls back to the snapshot map so it still renders under its kit.
    const liveKit = slice.assetKitId
      ? raw.assetKits.find((ak) => ak.id === slice.assetKitId)?.kit ?? null
      : null;
    const sliceKit =
      liveKit ??
      (slice.sourceKitId
        ? snapshotKitsById.get(slice.sourceKitId) ?? null
        : null);

    rows.push({
      ...raw,
      // Group by the resolved KIT id so per-slice rows land in the right kit
      // group (standalone slices stay individual).
      kitId: sliceKit?.id ?? null,
      kit: sliceKit
        ? { id: sliceKit.id, name: sliceKit.name, location: sliceKit.location }
        : null,
      location: getPrimaryLocation<{ name: string }>(raw),
      quantity: slice.quantity,
      bookingAssetId: slice.bookingAssetId,
    });
  }

  return rows;
}

/**
 * Source shape the PDF slice projection reads off each `BookingAsset.asset`.
 * `assetKits` supplies the membership → `Kit.id` mapping (already selected by
 * `BOOKING_WITH_ASSETS_INCLUDE`); `assetLocations` feeds the primary location.
 */
type PdfSliceSourceAsset = {
  assetKits: Array<{
    id: string;
    kit: { id: string; name: string; location: { name: string } | null } | null;
  }>;
  assetLocations?: Array<{ location?: { name: string } | null }>;
};

/** The per-slice fields layered onto each source asset by the projection. */
type PdfBookingAssetSliceProjection = {
  /**
   * The shared `Kit.id` of the slice's kit (`null` for a standalone slice) —
   * NOT the per-membership `AssetKit.id`. `filterBookingAssets` re-expands a
   * search match into its whole kit by grouping on this, so it MUST be the
   * `Kit.id` or an asset's kit siblings never surface on search.
   */
  kitId: string | null;
  /** The slice's `AssetKit.id` — the discriminator {@link buildPdfAssetRows} joins on. */
  assetKitId: string | null;
  /**
   * The slice's durable `BookingAsset.sourceKitId`. Survives the asset leaving
   * the kit (which `SET NULL`s `assetKitId`), so it is what lets a finished
   * booking's PDF keep rendering that slice under the kit it went out as part
   * of, instead of retroactively re-describing it as a loose asset.
   */
  sourceKitId: string | null;
  kit: { id: string; name: string; location: { name: string } | null } | null;
  location: { name: string } | null;
  quantity: number;
  bookingAssetId: string;
};

/**
 * Projects a booking's `BookingAsset` rows into the PER-SLICE list the PDF
 * export renders and searches over — one entry per slice (a standalone slice
 * plus one per kit the asset is booked under), each carrying its own booked
 * quantity and unique key.
 *
 * The load-bearing detail: `kitId` is set to the resolved **`Kit.id`**, not the
 * per-membership `AssetKit.id`. {@link filterBookingAssets} groups a search
 * match's kit siblings by `kitId`; setting it to the `AssetKit.id` (unique per
 * asset-in-kit) meant searching one kit member never surfaced the rest of the
 * kit in the exported PDF. The `AssetKit.id` is preserved separately as
 * `assetKitId` for {@link buildPdfAssetRows}'s per-slice kit join.
 *
 * @param bookingAssets - The booking's `BookingAsset` rows (each with its
 *   `assetKitId`, booked `quantity`, id, and the joined `asset` whose
 *   `assetKits` supply the `AssetKit.id` → `Kit.id` mapping).
 * @returns One projected slice per `BookingAsset` row.
 */
export function buildPdfBookingAssetSlices<TAsset extends PdfSliceSourceAsset>(
  bookingAssets: Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
    sourceKitId: string | null;
    asset: TAsset;
  }>
): Array<TAsset & PdfBookingAssetSliceProjection> {
  return bookingAssets.map((ba) => {
    const membership = ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId);
    const kit = membership?.kit ?? null;
    return {
      ...ba.asset,
      // Kit.id (shared across the kit) — drives search re-expansion + grouping.
      // Falls back to the durable `sourceKitId` when the membership is gone, so
      // a detached slice still groups with its kit siblings on search.
      kitId: kit?.id ?? ba.sourceKitId ?? null,
      // AssetKit.id (per membership) — the per-slice join discriminator.
      assetKitId: ba.assetKitId,
      sourceKitId: ba.sourceKitId,
      kit,
      location: getPrimaryLocation<{ name: string }>(ba.asset),
      quantity: ba.quantity,
      bookingAssetId: ba.id,
    };
  });
}
