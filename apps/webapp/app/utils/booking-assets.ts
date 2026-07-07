import { AssetStatus, KitStatus } from "@prisma/client";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";

/**
 * Minimal asset shape these booking-context helpers need: an `id` and a raw
 * `status` string. The index signature lets callers pass richer asset objects
 * (e.g. Prisma rows) without widening every call site.
 *
 * Pivot-derived callers (post `BookingAsset` pivot introduction): when iterating
 * a booking's `bookingAssets` relation, flatten each row to a denormalized
 * object before passing it here, e.g.:
 *
 * ```ts
 * const assetsList = booking.bookingAssets.map((ba) => ({
 *   ...ba.asset,
 *   bookingAssetId: ba.id,
 *   bookedQuantity: ba.quantity,
 *   kitId: ba.kitId ?? ba.asset.kitId ?? null,
 *   kit: ba.kit ?? ba.asset.kit ?? null,
 * }));
 * ```
 *
 * The flattened entries satisfy `AssetWithStatus` via `id`/`status` and the
 * pivot-only fields (`bookingAssetId`, `bookedQuantity`, etc.) ride along
 * through the open index signature — no type widening required.
 */
export type AssetWithStatus = {
  id: string;
  status: string;
  [key: string]: any;
};

/**
 * Minimal kit shape these helpers need: an `id`, a raw `status`, and optionally
 * its member assets (used to roll a kit's status up from its assets). The index
 * signature allows passing richer kit objects without widening call sites.
 */
export type KitWithStatus = {
  id: string;
  status: string;
  assets?: AssetWithStatus[];
  [key: string]: any;
};

/**
 * Booking-context status extensions beyond the raw Prisma `AssetStatus`:
 *
 * - `PARTIALLY_CHECKED_IN` — INDIVIDUAL-asset flow OR a fully-reconciled
 *   QUANTITY_TRACKED row (`dispositioned >= booked` for THIS row). Rendered
 *   as "Already checked in" (blue). Synthetic — only meaningful relative
 *   to a specific booking and never stored on the asset itself.
 * - `PARTIALLY_CHECKED_IN_QTY` — legacy Phase 3c label. Kept for callers
 *   that need the "Partially checked in" wording. Rendered amber.
 * - `PARTIALLY_CHECKED_OUT_QTY` — QUANTITY_TRACKED, this row has SOME
 *   units dispositioned but `remaining > 0`. Rendered as "Partially
 *   checked out" (violet) to emphasise that work is still outstanding.
 *   Booking rows use this in preference to `PARTIALLY_CHECKED_IN_QTY`
 *   so the user sees "still partly out" rather than "already partly in".
 * - `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` — QUANTITY_TRACKED, this row
 *   has had SOME units progressively checked out (`checkedOutQuantity > 0`)
 *   but NO units returned/consumed/lost/damaged yet
 *   (`dispositionedQuantity === 0`). Rendered as "Partially checked out"
 *   (amber) to mirror the legacy `PARTIALLY_CHECKED_IN_QTY` "action
 *   required" tone — the OUT-side equivalent. Distinct from
 *   `PARTIALLY_CHECKED_OUT_QTY` (violet, "returns underway") which fires
 *   once disposition has started.
 */
export type ExtendedAssetStatus =
  | AssetStatus
  | "PARTIALLY_CHECKED_IN"
  | "PARTIALLY_CHECKED_IN_QTY"
  | "PARTIALLY_CHECKED_OUT_QTY"
  | "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN";

/**
 * Kit status as surfaced in a booking context: the persisted {@link KitStatus}
 * plus the synthetic `"PARTIALLY_CHECKED_IN"` state (all member assets checked
 * in while the booking is still active). Not stored on the kit itself.
 */
export type ExtendedKitStatus = KitStatus | "PARTIALLY_CHECKED_IN";

/**
 * Context-aware asset status resolver for booking operations.
 *
 * Determines the effective status of an asset within a booking context:
 * - INDIVIDUAL asset, partial check-in + booking ONGOING/OVERDUE → PARTIALLY_CHECKED_IN
 * - INDIVIDUAL asset, otherwise → raw `Asset.status`
 *
 * QUANTITY_TRACKED assets need a different treatment for DRAFT/RESERVED
 * bookings. The global `Asset.status` (e.g. `CHECKED_OUT`) can reflect
 * state from a *different* active booking or stale data from a prior
 * cancellation — neither is relevant to a DRAFT/RESERVED row in the
 * current booking, and surfacing "Checked out" there is misleading
 * ("this booking hasn't checked anything out yet"). So for qty-tracked
 * assets we hard-override to `AVAILABLE` when the booking is
 * DRAFT/RESERVED, letting the row focus on this booking's own progress
 * (reserved qty, disposition indicator) rather than global pool state.
 */
export function getBookingContextAssetStatus(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): ExtendedAssetStatus {
  // Check if asset is partially checked in within this booking context
  const hasPartialCheckin = Boolean(partialCheckinDetails[asset.id]);

  // Only show as PARTIALLY_CHECKED_IN for active bookings
  // For COMPLETE bookings, assets should show as its Real status
  if (
    hasPartialCheckin &&
    bookingStatus &&
    ["ONGOING", "OVERDUE"].includes(bookingStatus)
  ) {
    return "PARTIALLY_CHECKED_IN";
  }

  /**
   * QUANTITY_TRACKED + DRAFT/RESERVED: the per-row badge should reflect
   * *this* booking's state, not the shared pool's. "Checked out" leaking
   * in from a prior booking (or from stale data) is noise at best and
   * incorrect at worst. Force AVAILABLE; the qty progress indicator
   * elsewhere in the row surfaces whatever real signal exists.
   */
  const isQtyTracked = (asset as { type?: string }).type === "QUANTITY_TRACKED";
  if (
    isQtyTracked &&
    (bookingStatus === "DRAFT" || bookingStatus === "RESERVED")
  ) {
    return AssetStatus.AVAILABLE;
  }

  return asset.status as AssetStatus;
}

/**
 * Helper to check if asset is effectively checked out in booking context
 * Returns true if asset needs to be checked in (not partially checked in)
 */
export function isAssetCheckedOutInBooking(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): boolean {
  const contextStatus = getBookingContextAssetStatus(
    asset,
    partialCheckinDetails,
    bookingStatus
  );
  return contextStatus === AssetStatus.CHECKED_OUT;
}

/**
 * Minimal shape of a raw `selectedBulkItemsAtom` entry that the booking bulk
 * helpers branch on. The atom holds a mix of paginated wrappers, kit entries,
 * and asset rows; every field is optional because which ones are present
 * depends on the entry kind, so an open index signature is the honest type.
 */
export type SelectedBookingItem = {
  [key: string]: any;
};

/**
 * Whether a selected asset is eligible to be CHECKED IN within this booking.
 *
 * An asset can be checked in only when it is effectively checked out for this
 * booking — i.e. its booking-context status is CHECKED_OUT (not already
 * partially checked in, and not AVAILABLE/never-checked-out). This is exactly
 * the predicate the bulk check-in dialog uses to filter its submitted set, so
 * the dropdown's enable/disable state can never disagree with the dialog.
 *
 * Intent-named delegate of {@link isAssetCheckedOutInBooking}, paired with
 * {@link isAssetCheckableOut} for symmetric, self-documenting call sites.
 *
 * @param asset - The selected asset (needs `id` and `status`).
 * @param partialCheckinDetails - Per-booking partial check-in records by id.
 * @param bookingStatus - The parent booking's status.
 * @returns `true` if the asset can be checked in.
 */
export function isAssetCheckableIn(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): boolean {
  return isAssetCheckedOutInBooking(
    asset,
    partialCheckinDetails,
    bookingStatus
  );
}

/**
 * Whether a selected asset is eligible to be CHECKED OUT for this booking.
 *
 * Two flavours of eligibility, decided by the asset's tracking type:
 *
 * - **INDIVIDUAL** (and the legacy fallback): binary. An asset can be checked
 *   out only when it is still booked — i.e. NOT already checked out. "Already
 *   checked out" means its id is in the booking's per-booking partial-checkout
 *   records OR its own status is CHECKED_OUT.
 * - **QUANTITY_TRACKED** with a `remainingByAssetId` map supplied: top-off
 *   aware. The asset stays eligible as long as it still has units remaining
 *   for THIS booking (`remaining > 0`), even if some units have already been
 *   checked out (the "partially checked out, top up the rest" case). When the
 *   map is omitted or doesn't contain this asset's id, falls back to the
 *   binary check — legacy loaders that don't yet plumb the remaining map keep
 *   their existing behaviour.
 *
 * Mirrors the bulk check-out dialog's filter so the dropdown and dialog agree.
 * Keeping the QT branch HERE (in one helper) is deliberate: list-bulk-actions
 * dropdown, the bulk partial-checkout dialog, and any future consumer all go
 * through one source of truth — no duplicated `type === "QUANTITY_TRACKED"`
 * checks scattered across call sites.
 *
 * NOTE: there is intentionally no QT branch on the check-IN side; check-in
 * eligibility is fully driven by `partialCheckinDetails` (consumed by
 * {@link isAssetCheckableIn} via {@link isAssetCheckedOutInBooking}), which
 * already covers the QUANTITY_TRACKED semantics correctly.
 *
 * @param asset - The selected asset (needs `id` and `status`). May also carry
 *   `type` so the QT branch can recognise it.
 * @param checkedOutAssetIds - Ids already checked out for this booking. A Set
 *   (not array) keeps membership O(1) across a large selection — matching the
 *   dialog's existing `checkedOutIdsSet`.
 * @param options.remainingByAssetId - Optional map of `assetId -> remaining
 *   units` for the current booking. When supplied for a QUANTITY_TRACKED
 *   asset, eligibility becomes `remaining > 0` instead of the binary check —
 *   so a partially-checked-out QT row stays eligible until every booked unit
 *   has been dispositioned. When the map is undefined (legacy callers) or the
 *   asset is missing from it, the binary fallback runs.
 * @returns `true` if the asset can be checked out.
 */
export function isAssetCheckableOut(
  asset: AssetWithStatus,
  checkedOutAssetIds: Set<string>,
  options?: { remainingByAssetId?: Record<string, number> }
): boolean {
  // QUANTITY_TRACKED + caller supplied the remaining map for this asset:
  // top-off eligibility — stay actionable while units remain for this booking.
  const isQtyTracked = (asset as { type?: string }).type === "QUANTITY_TRACKED";
  if (
    isQtyTracked &&
    options?.remainingByAssetId &&
    asset.id in options.remainingByAssetId
  ) {
    return (options.remainingByAssetId[asset.id] ?? 0) > 0;
  }

  // INDIVIDUAL (or QT without the map): binary fallback — preserves the
  // pre-existing behaviour for every legacy loader that hasn't been updated
  // to plumb the remaining map through yet.
  return !(
    checkedOutAssetIds.has(asset.id) || asset.status === AssetStatus.CHECKED_OUT
  );
}

/**
 * Normalizes the raw `selectedBulkItemsAtom` selection into a flat list of
 * enriched asset objects (plus kit entries kept for grouping), so every
 * consumer — the bulk-actions dropdown and both partial check-in/out dialogs —
 * evaluates the SAME data.
 *
 * The selection can contain several entry shapes:
 * - a pagination wrapper (`type: "asset"` with an `assets` array),
 * - a kit entry (`type: "kit"`, carrying its `kit` sub-object),
 * - a "traditional" kit (`name` + `_count`, no `title`),
 * - a direct asset (`title`, no `_count`).
 *
 * Asset entries are merged with their booking-scoped record from
 * `bookingAssets` so genuine gaps in the selection are filled. Kit entries are
 * returned flattened (`name`/`_count`) for rendering. This logic was previously
 * duplicated verbatim in both dialogs; extracting it removes the drift that
 * caused the bulk check-in bug.
 *
 * ### Per-slice enrichment (multi-slice QT support)
 *
 * A single `asset.id` can span MULTIPLE `BookingAsset` slices — e.g. a
 * QUANTITY_TRACKED asset booked both standalone (`kitId: null`) and inside a
 * kit (`kitId` set) is two distinct rows sharing one `asset.id`. To keep the
 * two slices distinct we key the enrichment map by `bookingAssetId` (falling
 * back to `id` for legacy entries that lack one), and look each selected item
 * up by `item.bookingAssetId ?? item.id`.
 *
 * The merge lets the SELECTED item WIN (`{ ...bookingAsset, ...item }`): the
 * selection atom holds the full enriched loader row, so its
 * `bookingAssetId`/`kitId`/`kit` are authoritative — the booking record only
 * fills genuine gaps. Merging the other way round would let a different slice's
 * `kitId` clobber the selected standalone slice's `kitId: null`, so the row
 * would render in neither the kit nor the individual bucket (the multi-slice
 * checkout bug this fix addresses).
 *
 * @param selectedItems - Raw entries from `selectedBulkItemsAtom`.
 * @param bookingAssets - The booking's assets (one entry per `BookingAsset`
 *   slice, each ideally carrying `bookingAssetId`), used to enrich asset
 *   entries by slice.
 * @returns The flattened, enriched list (assets + kit entries), UNFILTERED —
 *   callers apply their own eligibility filter.
 */
export function flattenSelectedBookingItems(
  selectedItems: SelectedBookingItem[],
  bookingAssets: AssetWithStatus[]
): SelectedBookingItem[] {
  // Key by `bookingAssetId` so two slices of the same `asset.id` stay
  // distinct; fall back to `id` for legacy entries without a slice id.
  const bookingAssetsMap = new Map(
    bookingAssets.map((asset) => [asset.bookingAssetId ?? asset.id, asset])
  );

  return selectedItems.flatMap((item) => {
    // Pagination wrapper objects (type "asset" with an assets array). Guard
    // that `assets` really is an array before mapping — a malformed entry must
    // not be treated as a list.
    if (item.type === "asset" && Array.isArray(item.assets)) {
      return (item.assets as SelectedBookingItem[]).map((asset) => {
        const bookingAsset = bookingAssetsMap.get(
          asset.bookingAssetId ?? asset.id
        );
        // Selected item wins so its per-slice bookingAssetId/kitId survive.
        return bookingAsset ? { ...bookingAsset, ...asset } : asset;
      });
    }

    // Kit entries (type "kit") — flatten name/_count for rendering.
    if (item.type === "kit") {
      return {
        ...item,
        name: item.kit?.name,
        _count: item.kit?._count,
      };
    }

    // Traditional kit shape (has name and _count, not title).
    if (item.name && item._count) {
      return item;
    }

    // Direct asset object (has title, not name) — enrich from booking record.
    if (item.title) {
      const bookingAsset = bookingAssetsMap.get(item.bookingAssetId ?? item.id);
      // Selected item wins so its per-slice bookingAssetId/kitId survive.
      return bookingAsset ? { ...bookingAsset, ...item } : item;
    }

    // Fallback for any other structure.
    return item;
  });
}

/**
 * Helper to check if asset is partially checked in within booking
 * Only returns true for ONGOING/OVERDUE bookings, false for COMPLETE bookings
 */
export function isAssetPartiallyCheckedIn(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): boolean {
  const hasPartialCheckin = Boolean(partialCheckinDetails[asset.id]);

  if (!hasPartialCheckin) {
    return false;
  }

  // Only consider as "partially checked in" for active & finished bookings
  return ["ONGOING", "OVERDUE", "COMPLETE", "ARCHIVED"].includes(bookingStatus);
}

/**
 * Human-readable check-in label for a single booking asset, for use in the
 * bookings CSV export.
 *
 * Mirrors the partial check-in semantics used across the booking UI
 * ({@link getBookingContextAssetStatus}, {@link calculatePartialCheckinProgress})
 * but flattens them to the three plain-text tokens an export consumer needs:
 *
 * - `"Checked in"`  — the asset has been returned. True when the booking is in
 *   a final state (COMPLETE/ARCHIVED, where every asset is returned by
 *   definition) OR when the asset appears in the booking's partial check-ins
 *   while the booking is still ONGOING/OVERDUE.
 * - `"Checked out"` — the booking is active (ONGOING/OVERDUE) and the asset has
 *   not yet been checked in.
 * - `""` (blank)    — check-in status does not apply. Covers DRAFT/RESERVED
 *   (nothing was ever checked out) and CANCELLED. CANCELLED is deliberately
 *   blank rather than labeled: `cancelBooking` returns assets to AVAILABLE only
 *   when cancelling from ONGOING/OVERDUE, but a RESERVED→CANCELLED booking never
 *   checked its assets out — and both collapse to the same `CANCELLED` status
 *   here, so we cannot tell them apart from status alone. Any affirmative label
 *   would be wrong for one path; blank is the only non-misleading value. The
 *   booking-level `Status`/rollup columns still show "Cancelled" and `0 / N`.
 *
 * The tokens are deliberately exact and status-agnostic so a downstream script
 * (e.g. a reminder workflow) can filter to "Checked out" across both
 * Checked-Out and Overdue bookings without parsing prose. A blank CANCELLED row
 * correctly yields no reminder (it won't match a "Checked out" filter).
 *
 * @param assetId - The asset whose label to resolve
 * @param checkedInAssetIds - Set of asset IDs partially checked in for the booking
 * @param bookingStatus - The parent booking's status (BookingStatus value)
 * @returns The export label: "Checked in", "Checked out", or "" when N/A
 */
export function getBookingAssetCheckinLabel(
  assetId: string,
  checkedInAssetIds: Set<string>,
  bookingStatus: string
): "Checked in" | "Checked out" | "" {
  // Final booking states: every asset is returned by definition.
  if (["COMPLETE", "ARCHIVED"].includes(bookingStatus)) {
    return "Checked in";
  }

  // Active states: distinguish returned vs still-out per asset.
  if (["ONGOING", "OVERDUE"].includes(bookingStatus)) {
    return checkedInAssetIds.has(assetId) ? "Checked in" : "Checked out";
  }

  // DRAFT / RESERVED — nothing was ever checked out.
  // CANCELLED — ambiguous (could be RESERVED→CANCELLED, never out, or
  // ONGOING/OVERDUE→CANCELLED, returned on cancel); blank is the only
  // non-misleading value since status alone can't distinguish them. See JSDoc.
  return "";
}

/**
 * Context-aware kit status resolver for booking operations
 *
 * Determines the effective status of a kit within a booking context:
 * - If ALL kit assets in booking have partial check-in details AND booking is ONGOING/OVERDUE -> PARTIALLY_CHECKED_IN
 * - If ALL kit assets in booking have partial check-in details AND booking is COMPLETE -> AVAILABLE
 * - Otherwise -> original database status
 *
 * This follows kit logic: Available = ALL assets available, Checked In = ALL assets checked in
 */
export function getBookingContextKitStatus(
  kit: KitWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingAssetIds: Set<string>,
  bookingStatus: string
): ExtendedKitStatus {
  const kitAssetsInBooking =
    kit.assets?.filter((asset) => bookingAssetIds.has(asset.id)) || [];

  /**
   * "All checked in" needs per-row awareness for QUANTITY_TRACKED kit
   * members. `partialCheckinDetails` is keyed by `assetId` and only
   * surfaces an asset when it's fully reconciled across the whole
   * booking — but with Polish-6 multi-row slices a qty-tracked member
   * can have its kit-driven slice fully reconciled (the only slice
   * relevant to this kit) while a parallel standalone slice still has
   * outstanding units. Fall back to per-row `bookedQuantity` vs
   * `dispositionedQuantity` when those are available on the asset.
   * INDIVIDUAL members keep the original `partialCheckinDetails` check.
   */
  const allAssetsCheckedIn =
    kitAssetsInBooking.length > 0 &&
    kitAssetsInBooking.every((asset) => {
      const a = asset as AssetWithStatus & {
        type?: string;
        bookedQuantity?: number;
        dispositionedQuantity?: number;
      };
      if (a.type === "QUANTITY_TRACKED") {
        const booked = a.bookedQuantity ?? 0;
        const dispositioned = a.dispositionedQuantity ?? 0;
        return booked > 0 && dispositioned >= booked;
      }
      return Boolean(partialCheckinDetails[asset.id]);
    });

  // why: kit-level partial-checkout rollup is deferred — per-asset rows under
  // the kit already surface the new state via list-asset-content; surfacing it
  // at the kit header would require a separate `checkedOutByAsset` plumbing
  // through getBookingContextKitStatus and a new ExtendedKitStatus member,
  // neither of which is needed for the immediate UX gap.
  // Only show as PARTIALLY_CHECKED_IN for active bookings
  // For COMPLETE bookings, kits should show as AVAILABLE
  if (
    allAssetsCheckedIn &&
    bookingStatus &&
    ["ONGOING", "OVERDUE"].includes(bookingStatus)
  ) {
    return "PARTIALLY_CHECKED_IN";
  }

  return kit.status as KitStatus;
}

/**
 * Helper to check if kit is effectively checked out in booking context
 * Returns true if kit needs to be checked in (not all assets checked in)
 */
export function isKitCheckedOutInBooking(
  kit: KitWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingAssetIds: Set<string>,
  bookingStatus: string
): boolean {
  const contextStatus = getBookingContextKitStatus(
    kit,
    partialCheckinDetails,
    bookingAssetIds,
    bookingStatus
  );
  return contextStatus === KitStatus.CHECKED_OUT;
}

/**
 * Helper to check if kit is partially checked in within booking
 * A kit is considered partially checked in only if ALL of its assets in the booking are checked in
 * AND the booking is ONGOING/OVERDUE (not COMPLETE)
 * This follows kit logic: Available = ALL assets available, Checked In = ALL assets checked in
 */
export function isKitPartiallyCheckedIn(
  kit: KitWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingAssetIds: Set<string>,
  bookingStatus: string
): boolean {
  const contextStatus = getBookingContextKitStatus(
    kit,
    partialCheckinDetails,
    bookingAssetIds,
    bookingStatus
  );
  return contextStatus === "PARTIALLY_CHECKED_IN";
}

/**
 * Minimal per-row shape needed to decide whether a booking's row (one
 * `BookingAsset` slice) is fully checked out on its own. `bookedQuantity` /
 * `checkedOutQuantity` / `dispositionedQuantity` are the per-slice counters the
 * overview loader attaches (keyed by `bookingAssetId`), so a kit-driven slice
 * and a standalone slice of the same asset are evaluated independently.
 *
 * Fields are typed `unknown` (narrowed inside the helpers) rather than `number`
 * so the loosely-typed enriched rows the callers hold pass without casts. No
 * index signature — callers with extra fields still structurally match these
 * optional fields, and keeping it index-free avoids leaking an `any`/`unknown`
 * open index into the resolver's public signature.
 */
export type QtyCheckoutRow = {
  type?: unknown;
  bookedQuantity?: unknown;
  checkedOutQuantity?: unknown;
  dispositionedQuantity?: unknown;
};

/** Coerce an unknown per-row counter to a finite number (0 when absent/NaN). */
function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Whether THIS row's own units are ALL progressively checked out with nothing
 * returned yet — i.e. the slice is fully out and should read as CHECKED_OUT.
 *
 * QUANTITY_TRACKED only: a QT asset can legitimately span multiple
 * `BookingAsset` slices (a kit-driven slice + a standalone free-pool slice),
 * so its GLOBAL `Asset.status` only flips to CHECKED_OUT once EVERY slice is
 * out (`bookedTotal` sums across slices). A single fully-checked-out slice
 * therefore can't be detected from the global status — it must be read from
 * the per-slice counters. Shared by the row badge in `list-asset-content.tsx`
 * and the status-sort's `isCheckedOut` predicate in
 * {@link file://../modules/booking/shape-booking-assets.ts} so the badge and
 * the sort position always agree.
 *
 * @param row - The per-slice row (type + per-row qty counters).
 * @param bookingStatus - Parent booking status; only ONGOING/OVERDUE are active.
 * @returns `true` when the slice is fully checked out with no disposition yet.
 */
export function isBookingRowQtyFullyCheckedOut(
  row: QtyCheckoutRow,
  bookingStatus: string
): boolean {
  const qtyBooked = toCount(row.bookedQuantity);
  const qtyCheckedOut = toCount(row.checkedOutQuantity);
  const qtyDispositioned = toCount(row.dispositionedQuantity);
  const isActiveBooking =
    bookingStatus === "ONGOING" || bookingStatus === "OVERDUE";
  return (
    row.type === "QUANTITY_TRACKED" &&
    qtyBooked > 0 &&
    qtyCheckedOut >= qtyBooked &&
    qtyDispositioned === 0 &&
    isActiveBooking
  );
}

/**
 * Input row for {@link resolveBookingRowQtyState}: the identity/status fields
 * {@link getBookingContextAssetStatus} needs plus the per-slice qty counters.
 * Index-signature-free and `any`-free, so callers pass their enriched rows
 * (which structurally satisfy these fields) without an `any`-indexed cast.
 */
export type BookingRowStatusInput = {
  id: string;
  status: string;
} & QtyCheckoutRow;

/** Resolved booking-row status plus the intermediate QT flags. */
export type BookingRowQtyState = {
  /** The badge status for this row (what `AssetStatusBadge` renders). */
  contextStatus: ExtendedAssetStatus;
  /** QT row fully reconciled (disposition ≥ booked) on an active booking. */
  isQtyFullyCheckedIn: boolean;
  /** QT row partly reconciled (some disposition, units still outstanding). */
  isQtyPartiallyCheckedIn: boolean;
  /** QT row with some (not all) units out and nothing returned yet. */
  isQtyPartiallyCheckedOut: boolean;
  /** QT row with ALL of its own units out and nothing returned yet. */
  isQtyFullyCheckedOut: boolean;
};

/**
 * Resolve one booking row's (slice's) badge status and the intermediate QT
 * flags. SINGLE source of truth shared by the row badge
 * (`list-asset-content.tsx`) and the status-sort predicate
 * (`shape-booking-assets.ts`) so the status a user sees on a row and the
 * bucket that row sorts into can never disagree.
 *
 * Priority (most specific signal wins):
 *  1. QT fully reconciled for this row → `PARTIALLY_CHECKED_IN`.
 *  2. QT partly reconciled (returns underway) → `PARTIALLY_CHECKED_OUT_QTY`.
 *  3. QT some units out, none returned yet → `..._QTY_PENDING_RETURN`.
 *  4. QT all of THIS slice's units out, none returned → `CHECKED_OUT`.
 *  5. Otherwise the global booking-context status
 *     ({@link getBookingContextAssetStatus}) — covers INDIVIDUAL assets and QT
 *     rows with no per-row activity (e.g. checked out via another booking).
 *
 * The per-row (per-`bookingAssetId`) quantity arms gate BEFORE the global
 * fallback, so a QT row with a partial return underway reads as its actionable
 * partial state and is NOT mis-bucketed as fully checked out just because the
 * asset's global status is `CHECKED_OUT` in a different active booking.
 *
 * @param row - The enriched row (id/status/type + per-row qty counters).
 * @param partialCheckinDetails - Per-booking partial check-in records by id.
 * @param bookingStatus - The parent booking's status.
 * @returns The resolved badge status and the QT flags used to derive it.
 */
export function resolveBookingRowQtyState(
  row: BookingRowStatusInput,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): BookingRowQtyState {
  const qtyBooked = toCount(row.bookedQuantity);
  const qtyCheckedOut = toCount(row.checkedOutQuantity);
  const qtyDispositioned = toCount(row.dispositionedQuantity);
  const qtyRemaining = Math.max(0, qtyBooked - qtyDispositioned);
  const isActiveBooking =
    bookingStatus === "ONGOING" || bookingStatus === "OVERDUE";
  const isQt = row.type === "QUANTITY_TRACKED";

  const isQtyFullyCheckedIn =
    isQt && qtyBooked > 0 && qtyDispositioned >= qtyBooked && isActiveBooking;
  const isQtyPartiallyCheckedIn =
    isQt &&
    qtyBooked > 0 &&
    qtyDispositioned > 0 &&
    qtyRemaining > 0 &&
    isActiveBooking;
  const isQtyPartiallyCheckedOut =
    isQt &&
    qtyBooked > 0 &&
    qtyCheckedOut > 0 &&
    qtyCheckedOut < qtyBooked &&
    qtyDispositioned === 0 &&
    isActiveBooking;
  const isQtyFullyCheckedOut = isBookingRowQtyFullyCheckedOut(
    row,
    bookingStatus
  );

  const contextStatus: ExtendedAssetStatus = isQtyFullyCheckedIn
    ? "PARTIALLY_CHECKED_IN"
    : isQtyPartiallyCheckedIn
    ? "PARTIALLY_CHECKED_OUT_QTY"
    : isQtyPartiallyCheckedOut
    ? "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN"
    : isQtyFullyCheckedOut
    ? AssetStatus.CHECKED_OUT
    : getBookingContextAssetStatus(row, partialCheckinDetails, bookingStatus);

  return {
    contextStatus,
    isQtyFullyCheckedIn,
    isQtyPartiallyCheckedIn,
    isQtyPartiallyCheckedOut,
    isQtyFullyCheckedOut,
  };
}
