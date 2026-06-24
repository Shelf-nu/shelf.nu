import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { AssetStatus, AssetType } from "@prisma/client";
import type { Booking } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useLoaderData } from "react-router";
import { z } from "zod";
import type { BookingExpectedAsset } from "~/atoms/qr-scanner";
import {
  bookingExpectedAssetsAtom,
  clearScannedItemsAtom,
  quickCheckoutQtyAssetAtom,
  QUICK_CHECKOUT_QR_PREFIX,
  removeScannedItemAtom,
  scannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import CheckoutDialog from "~/components/booking/checkout-dialog";
import { Form } from "~/components/custom-form";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { Progress } from "~/components/shared/progress";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import {
  countRemainingCheckoutAssets,
  isAssetCheckoutEligible,
  shouldPromptEarlyCheckout,
} from "~/modules/booking/helpers";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview.checkout-assets";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { tw } from "~/utils/tw";
import {
  createAvailabilityLabels,
  kitLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { GenericItemRow, DefaultLoadingState } from "../generic-item-row";
import { PendingItemsList, SectionHeader } from "./pending-items-list";

/** Narrowed alias used when classifying expected qty-tracked slices below. */
type QtyExpectedAsset = Extract<
  BookingExpectedAsset,
  { kind: "QUANTITY_TRACKED" }
>;
type IndividualExpectedAsset = Extract<
  BookingExpectedAsset,
  { kind: "INDIVIDUAL" }
>;

/**
 * Shape of a single per-slice checkout payload submitted by the drawer.
 *
 * Mirrors the check-IN drawer's `CheckinDisposition` but collapsed to a
 * single quantity field — checkout has no Lost/Damaged/Consumed split.
 *
 * - INDIVIDUAL assets: NOT included here. They ride the legacy `assetIds[]`
 *   array — presence means "check this asset out", quantity is implicit 1.
 * - QUANTITY_TRACKED assets: one entry per BookingAsset slice the user is
 *   actively checking out, with `quantity ≥ 1` and `≤ bookingAsset.quantity`.
 */
export const checkoutDispositionSchema = z.object({
  assetId: z.string().min(1),
  /**
   * `BookingAsset.id` this checkout targets. Required so the server can
   * attribute the qty to the correct slice (kit-driven vs standalone)
   * without greedy-fill on read.
   */
  bookingAssetId: z.string().min(1),
  /** Units to check out from this slice. Must be ≥ 1. */
  quantity: z.number().int().positive(),
});

export type CheckoutDispositionInput = z.infer<
  typeof checkoutDispositionSchema
>;

/**
 * Schema for the scanner-driven partial-checkout form payload.
 *
 * Exported and reused by `checkoutAssets` in service.server.ts.
 *
 * - `assetIds`: legacy per-asset list. Kept for back-compat with
 *   INDIVIDUAL assets and non-scanner entry points (bulk dialog, mobile).
 * - `checkouts`: JSON-encoded array of {@link CheckoutDispositionInput}.
 *   Emitted by the scanner drawer for QUANTITY_TRACKED slices so the
 *   server can write per-slice quantities. Same JSON-via-form-field
 *   pattern the check-IN drawer uses for its `checkins` payload.
 */
export const partialCheckoutAssetsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  checkouts: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null || value === "") return undefined;
      try {
        const parsed = JSON.parse(value);
        const result = z.array(checkoutDispositionSchema).safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid checkout disposition payload",
          });
          return z.NEVER;
        }
        return result.data;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "checkouts is not valid JSON",
        });
        return z.NEVER;
      }
    }),
});

/**
 * Per-slice checkout state tracked in the drawer.
 *
 * Stored as a string so an empty input stays empty (controlled
 * `value=""`) instead of coercing to 0. Converted to a number only at
 * submit time.
 */
type CheckoutQtyState = { quantity: string };

/** Keyed by `bookingAssetId` (slice), not `asset.id` — see Polish-7b. */
type CheckoutDispositionMap = Record<string, CheckoutQtyState>;

/**
 * Per-slice info needed to render the qty-input block: how many units
 * the operator can still check out from this slice and the slice's
 * asset metadata (for label and units-of-measure hints).
 */
type CheckoutQtyInfo = {
  /** `bookingAsset.quantity` for the slice — the upper bound for the input. */
  remaining: number;
  /** Asset's `unitOfMeasure` (e.g. "kg", "ml") — appended as a suffix when present. */
  unitOfMeasure: string | null;
};

/**
 * Context exposing per-slice qty-checkout state down into `AssetRow`.
 *
 * Mirrors `DispositionContext` from `partial-checkin-drawer.tsx`. Using
 * context (not prop drilling) because `AssetRow` is rendered via a
 * callback passed to `ConfigurableDrawer`, making direct prop passing
 * awkward.
 */
type CheckoutDispositionContextValue = {
  dispositions: CheckoutDispositionMap;
  /** Map of `bookingAssetId` → slice info (remaining units, unitOfMeasure). */
  qtyByBookingAssetId: Record<string, CheckoutQtyInfo>;
  updateQuantity: (bookingAssetId: string, value: string) => void;
};

const CheckoutDispositionContext =
  createContext<CheckoutDispositionContextValue | null>(null);

function useCheckoutDispositionContext(): CheckoutDispositionContextValue {
  const ctx = useContext(CheckoutDispositionContext);
  if (!ctx) {
    throw new Error(
      "useCheckoutDispositionContext called outside of PartialCheckoutDrawer"
    );
  }
  return ctx;
}

/** Parse a checkout qty state into a numeric quantity (empty → 0). */
function parseCheckoutQty(state: CheckoutQtyState | undefined): number {
  const n = Number(state?.quantity ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** Minimal asset shape the type-aware "fully checked out" predicate needs. */
type FullyCheckedOutAsset = {
  id: string;
  status: AssetStatus;
  type?: AssetType | string | null;
};

/**
 * Decide whether an asset is fully checked out on this booking — i.e. has
 * zero units left to check out and should be treated as a blocker / hide
 * the qty input.
 *
 * - INDIVIDUAL: binary — "fully out" iff live status is `CHECKED_OUT` OR
 *   the asset appears in a prior `PartialBookingCheckout` record.
 * - QUANTITY_TRACKED: gated on the loader-computed
 *   `remainingToCheckOutByAsset` (sum of remaining units across every
 *   slice on this booking). A partial top-off (e.g. 5 of 50 already out,
 *   45 still bookable) is NOT "fully out" — the asset stays scannable
 *   and the qty input renders with the remaining units pre-filled.
 *
 * Without the type branch a QT asset would be misclassified as
 * "already checked out" after the first partial checkout, preventing
 * the operator from topping off the remaining units via the scanner.
 *
 * @param asset Asset (id + live status + optional `type`)
 * @param remainingByAssetId Loader-supplied asset-level remaining map (QT only)
 * @param checkedOutIdSet Asset ids recorded in prior partial-checkouts
 * @returns `true` when no more units of the asset can be checked out
 */
function isAssetFullyCheckedOut(
  asset: FullyCheckedOutAsset,
  remainingByAssetId: Record<string, number>,
  checkedOutIdSet: Set<string>
): boolean {
  if (asset.type === "QUANTITY_TRACKED") {
    // Use the loader-supplied remaining only when an entry exists for
    // this asset. Absent entry = legacy/test path: fall back to the
    // binary gate so QT assets without a top-off map don't get flagged
    // "fully out" simply because the asset is missing from the map.
    if (asset.id in remainingByAssetId) {
      return (remainingByAssetId[asset.id] ?? 0) <= 0;
    }
  }
  return (
    asset.status === AssetStatus.CHECKED_OUT || checkedOutIdSet.has(asset.id)
  );
}

/** Props required to render the booking header row at the top of the drawer. */
type BookingHeaderBooking = Pick<
  Booking,
  "id" | "name" | "status" | "custodianUserId" | "from" | "to"
>;

/**
 * Renders the booking summary strip at the top of the partial check-out drawer.
 * Hoisted to module scope (instead of being a nested component) to avoid
 * remounting the header on every render of the parent drawer.
 */
function BookingHeader({ booking }: { booking: BookingHeaderBooking }) {
  return (
    <div className="border border-b-0 bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        {/* Left side: Booking name and status */}
        <div className="flex items-center gap-3">
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              <Button
                to={`/bookings/${booking.id}`}
                variant="link"
                className="text-left font-medium text-gray-900 hover:text-gray-700"
              >
                {booking.name}
              </Button>
            </span>
            <div>
              <BookingStatusBadge
                status={booking.status}
                custodianUserId={booking.custodianUserId || undefined}
              />
            </div>
          </div>
        </div>

        {/* Right side: Dates and progress */}
        <div className="flex items-center gap-6 text-sm">
          {/* From date */}
          <div className="text-right">
            <span className="block text-gray-600">From</span>
            <span className="block font-medium text-gray-900">
              <DateS date={booking.from} includeTime />
            </span>
          </div>

          {/* To date */}
          <div className="text-right">
            <span className="block text-gray-600">To</span>
            <span className="block font-medium text-gray-900">
              <DateS date={booking.to} includeTime />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Drawer component for managing scanned assets to be checked out from bookings
 */
// react-doctor:no-giant-component — deferred for follow-up refactor
export default function PartialCheckoutDrawer({
  className,
  style,
  isLoading,
  defaultExpanded = false,
}: {
  className?: string;
  style?: CSSProperties;
  isLoading?: boolean;
  defaultExpanded?: boolean;
}) {
  const {
    booking,
    checkedOutAssetIds,
    checkedInAssetIds,
    remainingToCheckOutByAsset,
  } = useLoaderData<typeof loader>();

  // Per-asset units-still-to-check-out map for QUANTITY_TRACKED assets,
  // folded across all slices of the asset on this booking. The loader
  // computes this via `computeBookingAssetRemainingToCheckOut` so the
  // drawer can support partial top-off: a QT asset with 2 of 5 units
  // already checked out is still scannable for the remaining 3 units.
  // INDIVIDUAL assets are absent from the map — their eligibility stays
  // binary (status / checkedOutIds).
  const remainingByAssetId: Record<string, number> =
    remainingToCheckOutByAsset ?? {};

  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // Read the seeded expected-asset list — populated by the checkout
  // route's `useBookingCheckinSessionInitialization` call. The atom is
  // shared across check-in and check-out (routes are never mounted at
  // the same time) so the same renderer can power both directions.
  const expectedAssets = useAtomValue(bookingExpectedAssetsAtom);

  // Dispatcher for inserting a synthetic "Check out without scanning"
  // entry into `scannedItemsAtom`. Wired to the pending-list's
  // `onQuickAction` below.
  const quickCheckoutQtyAsset = useSetAtom(quickCheckoutQtyAssetAtom);

  // Per-slice qty state — keyed by `bookingAssetId`, NOT `asset.id`, so a
  // single qty asset booked under multiple slices (kit-driven +
  // standalone) is reconciled independently. Each value defaults at
  // mount time to the slice's full `bookingAsset.quantity` (Wave B Q2:
  // the operator can dial it down but starts with the booked qty
  // pre-filled).
  const [checkoutDispositions, setCheckoutDispositions] =
    useState<CheckoutDispositionMap>({});

  const updateCheckoutQuantity = (bookingAssetId: string, value: string) => {
    setCheckoutDispositions((prev) => ({
      ...prev,
      [bookingAssetId]: { quantity: value },
    }));
  };

  // Filter and prepare data for component rendering
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // Post-pivot: assets live behind the BookingAsset pivot. Dedup by asset id —
  // a single asset can appear on multiple BookingAsset rows for qty-tracked
  // bookings (slices per kit / location). Downstream eligibility / blockers
  // treat assets as opaque IDs so we collapse to unique assets here.
  const bookingAssetsList = (() => {
    const seen = new Set<string>();
    const out: (typeof booking.bookingAssets)[number]["asset"][] = [];
    for (const ba of booking.bookingAssets) {
      if (!seen.has(ba.asset.id)) {
        seen.add(ba.asset.id);
        out.push(ba.asset);
      }
    }
    return out;
  })();

  // List of asset IDs for the form - only include assets that are actually in the booking
  const bookingAssetIds = new Set(bookingAssetsList.map((a) => a.id));

  // Get assets that have already been checked out (should be excluded from count)
  const alreadyCheckedOut = new Set(checkedOutAssetIds || []);

  // Assets already returned via partial check-in. They are AVAILABLE again but
  // DONE for this booking, so they must NOT be offered for checkout nor counted
  // in the "remaining to check out" denominator. Without this, a returned asset
  // that was checked out via the all-at-once flow (which leaves no
  // partial-checkout record) would be re-counted as still-bookable.
  const alreadyReturned = new Set(checkedInAssetIds || []);

  // Eligible to check out = in this booking AND still checkout-eligible. The
  // shared `isAssetCheckoutEligible` helper handles both:
  // - INDIVIDUAL: binary (not already out, not returned, not in custody);
  // - QUANTITY_TRACKED: partial top-off via `remainingByAssetId[id] > 0`,
  //   so an asset with 2 of 5 units already out is still scannable for the
  //   remaining 3.
  // This filter and the "remaining" denominator below describe the SAME set
  // (the progress bar can reach 100%). The server rejects over-committed /
  // in-custody assets; the corresponding blockers still surface them.
  const isCheckoutEligibleAsset = (a: {
    id: string;
    status: AssetStatus;
    type: AssetType;
  }) =>
    bookingAssetIds.has(a.id) &&
    isAssetCheckoutEligible(
      a,
      alreadyCheckedOut,
      alreadyReturned,
      remainingByAssetId
    );

  const assetIdsForCheckout = Array.from(
    new Set([
      ...assets.filter(isCheckoutEligibleAsset).map((a) => a.id),
      ...kits.flatMap((k) =>
        k.assetKits
          .map((ak) => ak.asset)
          .filter(isCheckoutEligibleAsset)
          .map((a) => a.id)
      ),
    ])
  );

  // Build the per-slice qty-info map from the booking's QUANTITY_TRACKED
  // BookingAsset rows. The map is keyed by `bookingAssetId` (slice id),
  // not asset id, so two slices of the same asset (kit-driven +
  // standalone) get independent rows. Slices whose asset is already
  // returned via partial check-in are skipped (terminal for that asset
  // on this booking).
  //
  // Per-slice `remaining` is derived from the asset-level
  // `remainingByAssetId` via a deterministic greedy allocation across
  // the asset's slices (ordered by `bookingAsset.id`). Each slice
  // claims up to its booked `quantity` from the asset's remaining
  // budget. This caps the qty input correctly under partial top-off
  // (5 of 50 already out → next scan's input maxes at 45) WITHOUT
  // letting a multi-slice asset over-commit by treating each slice as
  // having the full remaining budget. Slices that fall outside the
  // budget (or assets with no remaining) are omitted, which gates the
  // qty input off in `AssetRow`. Falls back to the booked quantity sum
  // when the loader didn't ship a value (older deploys / tests).
  const qtyByBookingAssetId = useMemo<Record<string, CheckoutQtyInfo>>(() => {
    const out: Record<string, CheckoutQtyInfo> = {};
    // Group QT slices by asset id so the greedy allocation sees them
    // together.
    const slicesByAsset = new Map<
      string,
      (typeof booking.bookingAssets)[number][]
    >();
    for (const ba of booking.bookingAssets) {
      if (ba.asset.type !== AssetType.QUANTITY_TRACKED) continue;
      if (alreadyReturned.has(ba.asset.id)) continue;
      const list = slicesByAsset.get(ba.asset.id) ?? [];
      list.push(ba);
      slicesByAsset.set(ba.asset.id, list);
    }
    for (const [assetId, slices] of slicesByAsset) {
      const fallbackTotal = slices.reduce(
        (acc, s) => acc + (s.quantity ?? 0),
        0
      );
      let assetRemaining = remainingByAssetId[assetId] ?? fallbackTotal;
      if (assetRemaining <= 0) continue;
      // Stable allocation order across renders — slice ids are
      // immutable so this is deterministic.
      const ordered = [...slices].sort((a, b) => a.id.localeCompare(b.id));
      for (const ba of ordered) {
        if (assetRemaining <= 0) break;
        const booked = ba.quantity ?? 0;
        if (booked <= 0) continue;
        const sliceRemaining = Math.min(booked, assetRemaining);
        if (sliceRemaining <= 0) continue;
        out[ba.id] = {
          remaining: sliceRemaining,
          unitOfMeasure: ba.asset.unitOfMeasure ?? null,
        };
        assetRemaining -= sliceRemaining;
      }
    }
    return out;
    // `booking.bookingAssets` is stable per loader response; the
    // remaining map and `Set`s only change when the loader refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.bookingAssets, checkedInAssetIds, remainingToCheckOutByAsset]);

  // Resolve which qty-tracked slices the operator is actively checking
  // out by intersecting (a) scanned-asset / scanned-kit membership with
  // (b) the per-slice qty map. A slice contributes when at least one of
  // its memberships is currently scanned.
  /**
   * Set of asset ids represented by the current scanned-items map.
   * Drives the pending-bucket filter at the `buckets` memo below
   * (`scannedAssetIds.has(asset.id)` excludes INDIVIDUAL entries that
   * have already been scanned this session — directly OR as members of
   * a scanned kit).
   *
   * Kit scans contribute every member asset's id, mirroring the
   * check-in drawer's behaviour (see
   * `partial-checkin-drawer.tsx:1060-1097`). Without the kit-member
   * contribution, scanning a kit leaves its INDIVIDUAL members in the
   * pending bucket and they double-render under the kit's name there
   * even though the kit already appears in "Checked out this session".
   *
   * Synthetic `qty-checkout:<bookingAssetId>` keys are intentionally
   * NOT contributed here — those track per-slice quick-checkout
   * activation via `activeQtySliceIds` (qty slices, not individual
   * asset ids). Errored items are skipped — they don't represent a
   * successful scan of any asset.
   */
  const scannedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [qrId, item] of Object.entries(items)) {
      if (!item || item.error) continue;
      // Synthetic quick-checkout keys represent per-slice qty
      // activation, not a physical INDIVIDUAL scan — they're tracked
      // separately via `activeQtySliceIds`. Skip them here so they
      // don't pollute the INDIVIDUAL-pending filter.
      if (qrId.startsWith(QUICK_CHECKOUT_QR_PREFIX)) continue;
      if (item.type === "asset") {
        const id = (item.data as { id?: string } | null | undefined)?.id;
        if (id) ids.add(id);
        continue;
      }
      if (item.type === "kit" && item.data) {
        // Kit payload exposes its members via `assetKits[].asset.id`
        // (see `KIT_INCLUDE` in `~/utils/scanner-includes.server.ts`).
        const assetKits = (
          item.data as { assetKits?: Array<{ asset?: { id?: string } }> }
        ).assetKits;
        for (const ak of assetKits ?? []) {
          if (ak?.asset?.id) ids.add(ak.asset.id);
        }
      }
    }
    return ids;
  }, [items]);

  // Polish-7b: resolve activation per-SLICE, not per-asset. An asset can
  // appear on multiple BookingAsset rows (kit-driven + standalone), and
  // dedup'ing by `asset.id` here would activate every sibling slice when
  // only one was scanned — the second slice's pending row would
  // disappear from the DOM, breaking independent quick-checkout. Mirror
  // of check-in's `bookingAssetIdForScannedItem`:
  //   - Synthetic quick-checkout key (`qty-checkout:<bookingAssetId>`)
  //     resolves to that exact slice.
  //   - Real qty-tracked scans carry `data.bookingAssetId` (set when the
  //     scanner attributes the scan to a slice) — use it directly.
  //   - Kit scans activate every kit-driven qty slice on this booking
  //     whose own `kitId` matches the scanned kit, matched against the
  //     loader's `expectedAssets` (the authoritative slice ↔ kit link).
  //   - Real INDIVIDUAL or qty scans without `bookingAssetId` are
  //     irrelevant to qty-slice activation (no input to render).
  const activeQtySliceIds = useMemo(() => {
    const out = new Set<string>();
    const activate = (bookingAssetId: string | undefined) => {
      if (!bookingAssetId) return;
      if (!qtyByBookingAssetId[bookingAssetId]) return;
      out.add(bookingAssetId);
    };

    for (const [qrId, item] of Object.entries(items)) {
      if (!item || item.error) continue;
      if (item.type === "asset") {
        if (qrId.startsWith(QUICK_CHECKOUT_QR_PREFIX)) {
          activate(qrId.slice(QUICK_CHECKOUT_QR_PREFIX.length));
          continue;
        }
        const baId = (
          item.data as { bookingAssetId?: string | null } | null | undefined
        )?.bookingAssetId;
        if (baId) activate(baId);
        continue;
      }
      if (item.type === "kit" && item.data) {
        const kitId = (item.data as { id?: string }).id;
        if (!kitId) continue;
        for (const a of expectedAssets) {
          if (a.kind === "QUANTITY_TRACKED" && a.kitId === kitId) {
            activate(a.bookingAssetId);
          }
        }
      }
    }
    return [...out];
  }, [items, qtyByBookingAssetId, expectedAssets]);

  // Serialize the active qty slices into the `checkouts` JSON payload
  // submitted alongside `assetIds[]`. Empty / 0 quantities are skipped
  // — the schema requires `quantity >= 1`.
  const checkoutsPayload: CheckoutDispositionInput[] = useMemo(() => {
    const out: CheckoutDispositionInput[] = [];
    const baById = new Map(booking.bookingAssets.map((ba) => [ba.id, ba]));
    for (const bookingAssetId of activeQtySliceIds) {
      const info = qtyByBookingAssetId[bookingAssetId];
      if (!info) continue;
      const ba = baById.get(bookingAssetId);
      if (!ba) continue;
      const state = checkoutDispositions[bookingAssetId];
      // Default to the full slice qty when the user has not interacted
      // with the input yet (Wave B Q2). `state.quantity === ""` (i.e.
      // the user cleared the input) keeps the value at 0 so the slice
      // is skipped — matches the check-IN drawer's "empty stays empty"
      // semantics.
      const qty =
        state === undefined ? info.remaining : parseCheckoutQty(state);
      if (qty <= 0) continue;
      const clamped = Math.min(qty, info.remaining);
      out.push({
        assetId: ba.asset.id,
        bookingAssetId,
        quantity: clamped,
      });
    }
    return out;
  }, [
    activeQtySliceIds,
    booking.bookingAssets,
    checkoutDispositions,
    qtyByBookingAssetId,
  ]);

  // Assets in this booking still available to check out (asset-scoped, so it
  // matches the asset-counted numerator regardless of the kits-as-unit setting).
  // Uses the same shared eligibility rule as the filter above, so the
  // denominator equals the set a user can actually scan out: excludes recorded
  // INDIVIDUAL checkouts, live CHECKED_OUT, already-returned (check-in), and
  // in-custody. For QUANTITY_TRACKED assets the helper now treats "fully
  // out" as `remainingByAssetId[id] === 0` — a partially-out QT asset still
  // counts in the denominator until every unit is claimed.
  const remainingBookedAssets = countRemainingCheckoutAssets(
    bookingAssetsList,
    checkedOutAssetIds || [],
    checkedInAssetIds || [],
    remainingByAssetId
  );

  // Early checkout only applies while the booking is still RESERVED, because
  // only that first scan transitions RESERVED → ONGOING and can adjust the
  // start date. Once the booking is ONGOING/OVERDUE the start date is fixed and
  // `partialCheckoutBooking` ignores the date choice, so prompting again on
  // subsequent scans would be a confusing no-op.
  const isEarlyCheckout = Boolean(
    assetIdsForCheckout.length > 0 &&
      shouldPromptEarlyCheckout(booking.status, booking.from)
  );

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers - only assets NOT in this booking
  const assetsNotInBookingIds = assets
    .filter((asset) => !bookingAssetIds.has(asset.id))
    .map((a) => a.id);

  // Assets that are FULLY checked out for this booking and therefore cannot
  // be checked out again. Type-aware via `isAssetFullyCheckedOut`:
  // - INDIVIDUAL: status CHECKED_OUT OR recorded in a prior partial-checkout.
  // - QUANTITY_TRACKED: only when `remainingByAssetId[id] === 0`. A QT asset
  //   with a partial top-off left (5 of 50 already out, 45 still bookable)
  //   does NOT land in this blocker — it must stay scannable.
  const alreadyCheckedOutAssets = assets
    .filter(
      (asset) =>
        bookingAssetIds.has(asset.id) &&
        isAssetFullyCheckedOut(asset, remainingByAssetId, alreadyCheckedOut)
    )
    .map((a) => a.id);

  const qrIdsOfAlreadyCheckedOutAssets = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "asset") return false;
      return alreadyCheckedOutAssets.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  // Assets currently held in custody — custody must be released before they can
  // be checked out.
  const assetsInCustody = assets
    .filter(
      (asset) =>
        bookingAssetIds.has(asset.id) && asset.status === AssetStatus.IN_CUSTODY
    )
    .map((a) => a.id);

  const qrIdsOfAssetsInCustody = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "asset") return false;
      return assetsInCustody.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  // why: conflict validation (asset checked out under a different booking) is
  // enforced server-side in partialCheckoutBooking, which throws a friendly
  // error. The scanned-asset payload (AssetFromQr) doesn't carry conflicting
  // bookings, so we deliberately don't build a client-side conflict blocker.

  // Note: In partial check-out context, we allow individual kit assets to be checked out
  // so we don't create blockers for assets that are part of kits

  // Kit blockers - kits not in this booking
  const kitsNotInBooking = kits
    .filter(
      (kit) => !kit.assetKits.some((ak) => bookingAssetIds.has(ak.asset.id))
    )
    .map((kit) => kit.id);

  const qrIdsOfKitsNotInBooking = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return kitsNotInBooking.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  // Kits that are already checked out for this booking (every kit asset in
  // booking is FULLY checked out — type-aware via `isAssetFullyCheckedOut`
  // so a kit containing a QT asset with remaining units doesn't trip this
  // blocker and the qty top-off can still flow through).
  const alreadyCheckedOutKits = kits
    .filter((kit) => {
      // Get kit assets that are in this booking (post-pivot: via assetKits[])
      const kitAssetsInBooking = kit.assetKits
        .map((ak) => ak.asset)
        .filter((asset) => bookingAssetIds.has(asset.id));

      // Kit is considered already checked out only if every one of its
      // in-booking assets has zero units left to check out.
      return (
        kitAssetsInBooking.length > 0 &&
        kitAssetsInBooking.every((asset) =>
          isAssetFullyCheckedOut(asset, remainingByAssetId, alreadyCheckedOut)
        )
      );
    })
    .map((kit) => kit.id);

  const qrIdsOfAlreadyCheckedOutKits = Object.entries(items)
    .filter(([_qrId, item]) => {
      if (!item || item.type !== "kit") return false;
      const kitId = (item?.data as any)?.id;
      const isAlreadyCheckedOut = alreadyCheckedOutKits.includes(kitId);

      return isAlreadyCheckedOut;
    })
    .map(([qrId]) => qrId);

  // Assets that are redundant because their kit is also scanned
  const redundantAssetIds: string[] = [];
  const qrIdsOfRedundantAssets: string[] = [];

  // Check for assets that belong to scanned kits
  assets.forEach((asset) => {
    // Post-pivot: kit membership lives on `Asset.assetKits[]`. Pick the first
    // pivot row's kitId for the customer-facing 1-asset-1-kit semantics this
    // redundancy check expresses.
    const assetKitId = asset.assetKits?.[0]?.kitId;
    if (!assetKitId) return;

    // Check if this asset's kit is also scanned
    const kitIsScanned = kits.some((kit) => kit.id === assetKitId);
    if (kitIsScanned && bookingAssetIds.has(asset.id)) {
      redundantAssetIds.push(asset.id);

      // Find the QR ID for this asset
      const assetQrId = Object.entries(items).find(
        ([, item]) =>
          item?.type === "asset" && (item?.data as any)?.id === asset.id
      )?.[0];

      if (assetQrId) {
        qrIdsOfRedundantAssets.push(assetQrId);
      }
    }
  });

  // Create blockers configuration
  const blockerConfigs = [
    {
      condition: assetsNotInBookingIds.length > 0,
      count: assetsNotInBookingIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> not
          part of this booking.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsNotInBookingIds),
    },
    {
      condition: alreadyCheckedOutAssets.length > 0,
      count: alreadyCheckedOutAssets.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""}`}</strong> already
          checked out for this booking.
        </>
      ),
      description: "These assets cannot be checked out again",
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyCheckedOutAssets),
    },
    {
      condition: assetsInCustody.length > 0,
      count: assetsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""}`}</strong> currently
          in custody — release custody first.
        </>
      ),
      description: "Release custody before checking these assets out",
      onResolve: () => removeItemsFromList(qrIdsOfAssetsInCustody),
    },
    {
      condition: alreadyCheckedOutKits.length > 0,
      count: alreadyCheckedOutKits.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s have" : " has"}`}</strong>{" "}
          already been checked out for this booking.
        </>
      ),
      description: "All assets from these kits have already been checked out",
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyCheckedOutKits),
    },
    {
      condition: redundantAssetIds.length > 0,
      count: redundantAssetIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already covered by scanned kit QR codes.
        </>
      ),
      description: "Kit QR codes include all kit assets automatically",
      onResolve: () => removeItemsFromList(qrIdsOfRedundantAssets),
    },
    {
      condition: kitsNotInBooking.length > 0,
      count: kitsNotInBooking.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong> not
          part of this booking.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsNotInBooking),
    },
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR codes `}</strong> are invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errors.map(([qrId]) => qrId)),
    },
  ];

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {
      removeAssetsFromList([...assetsNotInBookingIds]);
      removeItemsFromList([
        ...errors.map(([qrId]) => qrId),
        ...qrIdsOfKitsNotInBooking,
        ...qrIdsOfRedundantAssets,
        ...qrIdsOfAlreadyCheckedOutAssets,
        ...qrIdsOfAssetsInCustody,
        ...qrIdsOfAlreadyCheckedOutKits,
      ]);
    },
  });

  /**
   * Stable kitId → kit meta map for the pending-list renderer. Derived
   * from the loader's `expectedKits` payload (seeded into the shared
   * atom alongside `expectedAssets`).
   *
   * The atom holds `expectedAssets` directly but not the kit summaries;
   * we rebuild the map from each expected entry's `kitId` + `kitName`
   * here so the pending-list keeps its current `kitMetaById` API. Image
   * data isn't carried on `BookingExpectedAsset`, so kit thumbnails
   * fall back to `null` — matches the check-in drawer's behaviour for
   * entries whose loader-supplied kit lacks an image.
   */
  const kitMetaById = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; mainImage: string | null }
    >();
    for (const asset of expectedAssets) {
      if (!asset.kitId) continue;
      if (map.has(asset.kitId)) continue;
      map.set(asset.kitId, {
        id: asset.kitId,
        name: asset.kitName ?? "",
        mainImage: null,
      });
    }
    return map;
  }, [expectedAssets]);

  /**
   * Bucket expected assets into pending vs scanned-this-session.
   *
   * Mirrors the check-in drawer's bucketing (`partial-checkin-drawer
   * .tsx:1119–1244`) but collapsed to checkout's single-quantity
   * disposition shape:
   *
   *  - A qty slice is `scannedWithPending` when the scanned
   *    `checkoutDispositions[baId].quantity` is LESS than the slice's
   *    `qtyByBookingAssetId[baId].remaining` (operator is only
   *    checking out part of what's available — slice stays partial).
   *  - Otherwise the slice is `scannedComplete` (fully claimed for
   *    this session — equal-to-remaining counts as complete).
   *  - Pending qty = qty slices whose `bookingAssetId` is NOT in
   *    `activeQtySliceIds`.
   *  - Pending individual = INDIVIDUAL expected entries whose asset id
   *    is NOT in `scannedAssetIds` AND NOT in `checkedOutAssetIds`
   *    (already-checked-out individuals are terminal for this booking
   *    direction — they don't need to be surfaced as pending).
   *  - `alreadyReconciled` qty slices (`remaining === 0`) are dropped
   *    from the pending bucket — they have nothing left to claim and
   *    the checkout drawer doesn't have a dedicated "already done"
   *    section yet (deliberate scope deferral; see plan).
   */
  const buckets = useMemo(() => {
    const activeSliceIdSet = new Set(activeQtySliceIds);
    const pendingIndividuals: IndividualExpectedAsset[] = [];
    const pendingQtyTracked: QtyExpectedAsset[] = [];

    for (const asset of expectedAssets) {
      if (asset.kind === "INDIVIDUAL") {
        // Skip individuals already scanned this session.
        if (scannedAssetIds.has(asset.id)) continue;
        // Skip individuals already checked out on a prior session —
        // they're terminal for this direction. (`alreadyCheckedIn` on
        // the union carries "already reconciled in this direction" for
        // the checkout loader — semantics flipped at the source.)
        if (asset.alreadyCheckedIn) continue;
        if (alreadyCheckedOut.has(asset.id)) continue;
        pendingIndividuals.push(asset);
        continue;
      }

      // QUANTITY_TRACKED: a slice activated by a scan this session
      // (real scan OR synthetic quick-checkout) renders in the
      // scanned-this-session bucket above and must NOT appear pending.
      if (activeSliceIdSet.has(asset.bookingAssetId)) continue;
      if (asset.remaining === 0) continue;
      pendingQtyTracked.push(asset);
    }

    return { pendingIndividuals, pendingQtyTracked };
  }, [expectedAssets, scannedAssetIds, activeQtySliceIds, alreadyCheckedOut]);

  const pendingCount =
    buckets.pendingIndividuals.length + buckets.pendingQtyTracked.length;

  /**
   * Stable callback for the row's onRemove — keeps the extracted
   * scanned-row component's prop identity stable across renders so
   * React can reconcile it in place.
   */
  const onRemoveScanned = removeItem;

  /**
   * Invoked when the operator clicks "Check out without scanning" on a
   * pending qty row. Dispatches the synthetic-scan atom; the new
   * entry lands under `qty-checkout:<bookingAssetId>` and the drawer
   * reclassifies it into the scanned-this-session bucket on the next
   * render.
   */
  const handleQuickCheckout = useCallback(
    (asset: QtyExpectedAsset) => {
      quickCheckoutQtyAsset(asset);
    },
    [quickCheckoutQtyAsset]
  );

  /**
   * Unified renderer: drive both buckets in a single pass. Scanned
   * rows render through `GenericItemRow` (existing behaviour);
   * pending rows go through the shared `PendingItemsList` under
   * `mode="checkout"`.
   *
   * Render order (top → bottom):
   *  1. Active section header (when ≥1 scanned this session).
   *  2. Scanned rows (asset + kit, in iteration order of `items`).
   *  3. PendingItemsList header + grouped pending rows.
   */
  const customRenderAllItems = useCallback((): ReactNode => {
    const scannedQrIdsInOrder = Object.keys(items);
    const scannedCount = scannedQrIdsInOrder.length;

    return (
      <>
        {scannedCount > 0 ? (
          <SectionHeader
            label={`Checked out this session (${scannedCount})`}
            tone="active"
          />
        ) : null}

        {scannedQrIdsInOrder.map((qrId) => {
          const item = items[qrId];
          return (
            <GenericItemRow
              key={qrId}
              qrId={qrId}
              item={item}
              onRemove={onRemoveScanned}
              renderLoading={(pendingQrId, error) => (
                <DefaultLoadingState qrId={pendingQrId} error={error} />
              )}
              renderItem={(data) => {
                if (item?.type === "asset") {
                  return <AssetRow asset={data as AssetFromQr} />;
                } else if (item?.type === "kit") {
                  return <KitRow kit={data as KitFromQr} />;
                }
                return null;
              }}
            />
          );
        })}

        {/* Pending section (Polish-7b — grouped by each entry's OWN
            `kitId`). Renderer lives in `pending-items-list.tsx`; we
            wire `mode="checkout"` so the copy + key prefixes match the
            checkout direction. */}
        <PendingItemsList
          mode="checkout"
          pendingIndividuals={buckets.pendingIndividuals}
          pendingQtyTracked={buckets.pendingQtyTracked}
          kitMetaById={kitMetaById}
          onQuickAction={handleQuickCheckout}
          pendingCount={pendingCount}
        />
      </>
    );
  }, [
    buckets,
    handleQuickCheckout,
    items,
    kitMetaById,
    onRemoveScanned,
    pendingCount,
  ]);

  const contextValue: CheckoutDispositionContextValue = {
    dispositions: checkoutDispositions,
    qtyByBookingAssetId,
    updateQuantity: updateCheckoutQuantity,
  };

  return (
    <CheckoutDispositionContext.Provider value={contextValue}>
      <ConfigurableDrawer
        schema={partialCheckoutAssetsSchema}
        items={items}
        onClearItems={clearList}
        form={
          <CustomForm
            assetIdsForCheckout={assetIdsForCheckout}
            checkoutsPayload={checkoutsPayload}
            isEarlyCheckout={isEarlyCheckout}
            booking={booking}
            isLoading={isLoading}
            hasBlockers={hasBlockers}
          />
        }
        title={
          <div className="text-right">
            <span className="flex items-center justify-end gap-1 text-gray-600">
              {assetIdsForCheckout.length}/{remainingBookedAssets} Assets
              scanned
              <InfoTooltip
                iconClassName="size-4"
                content={<p>All assets inside kits are counted individually</p>}
              />
            </span>
            <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
              <Progress
                value={
                  remainingBookedAssets > 0
                    ? (assetIdsForCheckout.length / remainingBookedAssets) * 100
                    : 0
                }
              />
            </span>
          </div>
        }
        isLoading={isLoading}
        customRenderAllItems={customRenderAllItems}
        // Render body even when nothing has been scanned yet — pending
        // rows still need to be visible so the operator knows what's
        // still owed on the booking.
        renderWhenEmpty
        Blockers={Blockers}
        defaultExpanded={defaultExpanded}
        className={tw(
          "[&_.default-base-drawer-header]:rounded-b [&_.default-base-drawer-header]:border [&_.default-base-drawer-header]:px-4 [&_thead]:hidden",
          className
        )}
        style={style}
        headerContent={<BookingHeader booking={booking} />}
      />
    </CheckoutDispositionContext.Provider>
  );
}

// Asset row renderer
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const { booking, checkedOutAssetIds, remainingToCheckOutByAsset } =
    useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  const alreadyCheckedOut = new Set(checkedOutAssetIds || []);
  // Loader-supplied asset-level remaining map (QT only). See
  // `isAssetFullyCheckedOut` for the type-aware branching.
  const remainingByAssetId: Record<string, number> =
    remainingToCheckOutByAsset ?? {};

  // Check if asset is in this booking. Post-pivot, booking-asset membership
  // lives behind the BookingAsset pivot row.
  const isInBooking = booking.bookingAssets.some(
    (ba) => ba.asset.id === asset.id
  );

  // Check if asset is fully checked out — type-aware. For a QT asset with
  // a partial top-off pending (e.g. 5 of 50 already out, 45 left) this is
  // false so the "Already checked out" badge is suppressed and the qty
  // input renders.
  const isAlreadyCheckedOut = isAssetFullyCheckedOut(
    asset,
    remainingByAssetId,
    alreadyCheckedOut
  );

  // Check if asset is currently in custody (must be released before check-out)
  const isInCustody = asset.status === AssetStatus.IN_CUSTODY;

  // Post-pivot: kit membership lives on `asset.assetKits[]`. Take the first
  // pivot row's kitId for the customer-facing 1-asset-1-kit semantics here.
  const assetKitId = asset.assetKits?.[0]?.kitId ?? null;

  // Check if this asset is redundant (kit is also scanned)
  const isRedundant =
    !!assetKitId &&
    (() => {
      const kits = Object.values(items)
        .filter((item) => !!item && item.data && item.type === "kit")
        .map((item) => item?.data as any);
      return kits.some((kit) => kit.id === assetKitId);
    })();

  // Check if this is the last asset of a kit in this booking
  const isLastKitAssetInBooking =
    !!assetKitId &&
    (() => {
      const kitAssetsInBooking = booking.bookingAssets
        .map((ba) => ba.asset)
        .filter((a) => a.assetKits?.[0]?.kitId === assetKitId);
      return (
        kitAssetsInBooking.length === 1 && kitAssetsInBooking[0].id === asset.id
      );
    })();

  // An active synthetic entry (via quick-checkout) lives under a key
  // prefixed by `qty-checkout:` + the slice's `bookingAssetId`. The
  // synthetic-entry payload also carries `data.bookingAssetId` so we
  // can read the slice id straight off the scanned-item shape (set by
  // `quickCheckoutQtyAssetAtom`). Used below to pick between the
  // default checkout badges and the indigo "Checked out without
  // scan" marker. Mirrors check-in's `isQuickCheckin` probe.
  const scannedBookingAssetId =
    asset.type === AssetType.QUANTITY_TRACKED
      ? (asset as unknown as { bookingAssetId?: string | null })
          .bookingAssetId ?? null
      : null;
  const isQuickCheckout = Boolean(
    scannedBookingAssetId &&
      items[`${QUICK_CHECKOUT_QR_PREFIX}${scannedBookingAssetId}`]
  );

  // Use custom configurations for partial check-out context
  const availabilityConfigs = [
    // Custom preset for redundant assets (highest priority - blocking issue)
    {
      condition: isRedundant && isInBooking,
      badgeText: "Already covered by kit QR",
      tooltipTitle: "Asset already covered",
      tooltipContent:
        "This asset is already covered by the scanned kit QR code. Remove this individual asset scan.",
      priority: 90, // Highest priority - blocking issue
    },
    // Custom preset for QUANTITY_TRACKED assets with zero remaining units —
    // surfaces the precise reason ("no units left to claim") instead of
    // the generic "already checked out" badge so the operator can tell
    // apart "fully consumed" from "partially out" (the latter is still
    // scannable).
    {
      condition:
        isAlreadyCheckedOut &&
        isInBooking &&
        asset.type === AssetType.QUANTITY_TRACKED,
      badgeText: "No units remaining",
      tooltipTitle: "All booked units already checked out",
      tooltipContent:
        "Every unit of this quantity-tracked asset has already been checked out for this booking. Nothing left to scan.",
      priority: 85, // High priority - blocking issue
    },
    // Custom preset for INDIVIDUAL already-checked-out assets. QT assets
    // route through the "No units remaining" preset above; landing here
    // would only fire for INDIVIDUAL (binary) assets.
    {
      condition:
        isAlreadyCheckedOut &&
        isInBooking &&
        asset.type !== AssetType.QUANTITY_TRACKED,
      badgeText: "Already checked out",
      tooltipTitle: "Asset already checked out",
      tooltipContent:
        "This asset has already been checked out for this booking and cannot be checked out again.",
      priority: 85, // High priority - blocking issue
    },
    // Custom preset for assets in custody
    {
      condition: isInCustody && isInBooking,
      badgeText: "In custody",
      tooltipTitle: "Asset in custody",
      tooltipContent:
        "This asset is currently in custody. Release the custody before checking it out.",
      priority: 84, // High priority - blocking issue
    },
    // Custom preset for "not in this booking"
    {
      condition: !isInBooking,
      badgeText: "Not in this booking",
      tooltipTitle: "Asset not part of booking",
      tooltipContent:
        "This asset is not part of the current booking and cannot be checked out.",
      priority: 80,
      // Uses default warning colors (appropriate for blocking issue)
    },
    // Custom preset for kit assets - different message based on whether it's the last one
    {
      condition: !!assetKitId && !isRedundant, // Only show if not redundant
      badgeText: "Part of kit",
      tooltipTitle: "Asset is part of a kit",
      tooltipContent: isLastKitAssetInBooking
        ? "This is the last asset from this kit in the booking. Checking it out will also mark the entire kit as checked out."
        : "This asset belongs to a kit. Checking out this asset individually will not affect the kit status or other kit assets.",
      priority: 60, // Lower priority than blocking issues
      className: "bg-blue-50 border-blue-200 text-blue-700", // Informational blue
    },
    // Positive marker for rows added via the "Check out without
    // scanning" affordance on a pending qty row. Mirrors check-in's
    // "Checked in without scan" indigo badge — only fires when the
    // row has a synthetic-key entry under `qty-checkout:` AND no
    // higher-priority warning (redundant / fully checked out / in
    // custody / not in booking) suppresses it. The presence of this
    // badge differentiates quick-checkout rows from real scans at a
    // glance, beyond the presence/absence of the qty input.
    {
      condition:
        isInBooking &&
        !isRedundant &&
        !isAlreadyCheckedOut &&
        !isInCustody &&
        isQuickCheckout,
      badgeText: "Checked out without scan",
      tooltipTitle: "Marked out without scanning",
      tooltipContent:
        "This quantity-tracked asset was added via the Check out without scanning button — no QR scan required.",
      priority: 50,
      className: "bg-indigo-50 border-indigo-200 text-indigo-700",
    },
  ];

  // Create the availability labels component
  const [, AssetAvailabilityLabels] =
    createAvailabilityLabels(availabilityConfigs);

  const { qtyByBookingAssetId } = useCheckoutDispositionContext();

  // Resolve the BookingAsset slice this scanned QT asset targets. The
  // drawer's `qtyByBookingAssetId` only contains slices that still have
  // units to claim (after the greedy allocation against the loader's
  // asset-level remaining map), so picking the first matching key for
  // this asset also picks the first slice with `remaining > 0`. The
  // slice order matches the allocator's stable `id` sort so the qty
  // input lines up with the units the allocator reserved for that
  // slice. INDIVIDUAL assets and assets not in the booking get `null`.
  const bookingAssetId =
    asset.type === AssetType.QUANTITY_TRACKED
      ? booking.bookingAssets
          .filter((ba) => ba.asset.id === asset.id)
          .sort((a, b) => a.id.localeCompare(b.id))
          .find((ba) => qtyByBookingAssetId[ba.id])?.id ?? null
      : null;

  const qtyInfo = bookingAssetId
    ? qtyByBookingAssetId[bookingAssetId] ?? null
    : null;

  const showQtyControls =
    !!qtyInfo &&
    !!bookingAssetId &&
    isInBooking &&
    !isAlreadyCheckedOut &&
    !isInCustody &&
    qtyInfo.remaining > 0;

  return (
    // Mobile: title column + qty block stack vertically (block grows to
    // full width below the title). Desktop (`sm:` ~640px+): side-by-side
    // with the block as a fixed-width right column — mirrors the
    // partial-check-IN drawer's two-column layout exactly.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {/* Left column: asset title + badges. `min-w-0` so long titles
          can wrap instead of pushing the qty block off-screen. */}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="word-break whitespace-break-spaces font-medium">
          {asset.title}
        </p>

        <div className="flex flex-wrap items-center gap-1">
          <span
            className={tw(
              "inline-block bg-gray-50 px-[6px] py-[2px]",
              "rounded-md border border-gray-200",
              "text-xs text-gray-700"
            )}
          >
            asset
          </span>
          <AssetAvailabilityLabels />
        </div>
      </div>

      {/* Right column: qty checkout block (QUANTITY_TRACKED only). */}
      {showQtyControls ? (
        <QuantityCheckoutBlock
          bookingAssetId={bookingAssetId!}
          info={qtyInfo!}
        />
      ) : null}
    </div>
  );
}

/**
 * Quantity checkout block shown to the right of (or below, on mobile)
 * the asset title + badge for a QUANTITY_TRACKED asset that still has
 * units to check out on this booking.
 *
 * Mirrors the layout of the partial-check-IN drawer's
 * `QuantityDispositionBlock` but collapsed to a SINGLE primary input —
 * checkout has no Lost / Damaged / Consumed split, so the shortfall
 * row is unnecessary.
 *
 * Structure:
 *   `Check out [input] of N {unitOfMeasure?}`
 *
 * Default value: the slice's full `remaining`. The user can dial it
 * down (Wave B Q2). `min=1` / `max=remaining` clamp the range; the
 * payload builder further clamps at submit time as a defensive measure.
 *
 * Renders nothing for INDIVIDUAL assets or fully-reconciled slices —
 * the caller guards on `showQtyControls`.
 */
function QuantityCheckoutBlock({
  bookingAssetId,
  info,
}: {
  bookingAssetId: string;
  info: CheckoutQtyInfo;
}) {
  const { dispositions, updateQuantity } = useCheckoutDispositionContext();
  // Default value: full slice qty. Tracked as a string so an empty
  // input stays empty (controlled `value=""`) instead of coercing to 0.
  const state = dispositions[bookingAssetId];
  const value = state === undefined ? String(info.remaining) : state.quantity;

  // Focus the input on mount via the shared hook (per
  // `.claude/rules/use-auto-focus-hook.md`). The drawer renders one
  // block per scanned qty asset; on mount we draw the operator's
  // attention to the latest row so they can dial the qty down without
  // hunting for the field.
  const inputRef = useAutoFocus<HTMLInputElement>();

  return (
    <div
      className={tw(
        // Match the check-IN block's box: full width on mobile, fixed
        // 256px right column on desktop with `shrink-0` so inputs
        // don't squish when the title wraps.
        "w-full rounded-md border border-gray-200 bg-white px-3 py-2 sm:w-64 sm:shrink-0"
      )}
    >
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-gray-700">Check out</span>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={info.remaining}
            step={1}
            value={value}
            onChange={(e) => updateQuantity(bookingAssetId, e.target.value)}
            inputMode="numeric"
            aria-label="Check out quantity"
            className={tw(
              "w-14 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums text-gray-900",
              "focus:outline-none focus:ring-1 focus:ring-primary-500",
              "[appearance:textfield]",
              "[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none",
              "[&::-webkit-outer-spin-button]:appearance-none"
            )}
          />
          <span className="text-xs tabular-nums text-gray-500">
            of {info.remaining}
            {info.unitOfMeasure ? ` ${info.unitOfMeasure}` : ""}
          </span>
        </div>
      </label>
    </div>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
  const { booking, checkedOutAssetIds, remainingToCheckOutByAsset } =
    useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  // Post-pivot: kit's assets live behind `kit.assetKits[].asset`; booking-side
  // membership lives behind the BookingAsset pivot. Build a flat list of kit
  // assets once.
  const kitAssetsAll = kit.assetKits.map((ak) => ak.asset);

  // Check how many assets from this kit are in the booking
  const bookingAssetIds = new Set(
    booking.bookingAssets.map((ba) => ba.asset.id)
  );
  const kitAssetsInBooking = kitAssetsAll.filter((a) =>
    bookingAssetIds.has(a.id)
  );
  const allKitAssetsInBooking =
    kitAssetsInBooking.length === kitAssetsAll.length;
  const noKitAssetsInBooking = kitAssetsInBooking.length === 0;

  // Assets already checked out for this booking
  const alreadyCheckedOut = new Set(checkedOutAssetIds || []);
  const remainingByAssetId: Record<string, number> =
    remainingToCheckOutByAsset ?? {};

  // Type-aware predicate: QT assets are "checked out" only when zero units
  // remain, so a partial top-off keeps them in the "remaining" bucket and
  // the kit row still counts them toward the to-be-checked-out total.
  const isAssetCheckedOut = (asset: {
    id: string;
    status: AssetStatus;
    type?: AssetType | string | null;
  }) => isAssetFullyCheckedOut(asset, remainingByAssetId, alreadyCheckedOut);

  // Check if this kit is currently scanned
  const isKitScanned = Object.values(items).some(
    (item) => item?.type === "kit" && (item?.data as KitFromQr)?.id === kit.id
  );

  // Calculate remaining assets (not already checked out)
  const uncheckedKitAssetsInBooking = kitAssetsInBooking.filter(
    (asset) => !isAssetCheckedOut(asset)
  );

  const remainingKitAssetsInBooking = isKitScanned
    ? [] // If kit is scanned, no assets are remaining (the unchecked ones will be checked out)
    : uncheckedKitAssetsInBooking;
  const totalKitAssetsInBooking = kitAssetsInBooking.length;

  // Check if all kit assets in booking are already checked out
  const allKitAssetsInBookingAreCheckedOut =
    kitAssetsInBooking.length > 0 &&
    kitAssetsInBooking.every((asset) => isAssetCheckedOut(asset));

  // Use preset configurations to define the availability labels
  const availabilityConfigs = [
    // Custom preset for "already checked out" kits (highest priority - blocking issue)
    {
      condition: allKitAssetsInBookingAreCheckedOut,
      badgeText: "Already checked out",
      tooltipTitle: "Kit already checked out",
      tooltipContent:
        "All assets from this kit have already been checked out for this booking and cannot be checked out again.",
      priority: 85, // High priority - blocking issue
    },
    kitLabelPresets.inCustody(kit.status === AssetStatus.IN_CUSTODY),
    kitLabelPresets.hasAssetsInCustody(
      kitAssetsAll.some((asset) => asset.status === AssetStatus.IN_CUSTODY)
    ),
    // Custom preset for "not in booking"
    {
      condition: noKitAssetsInBooking,
      badgeText: "Not in this booking",
      tooltipTitle: "Kit not part of booking",
      tooltipContent:
        "None of this kit's assets are part of the current booking.",
      priority: 80,
    },
    // Custom preset for "partially in booking" - informational only
    {
      condition: !allKitAssetsInBooking && !noKitAssetsInBooking,
      badgeText: `${kitAssetsInBooking.length}/${kitAssetsAll.length} assets in booking`,
      tooltipTitle: "Kit partially in booking",
      tooltipContent:
        "Only some of this kit's assets are part of the current booking.",
      priority: 70,
      className: "bg-blue-50 border-blue-200 text-blue-700", // Informational blue
    },
  ];

  // Create the availability labels component with default options
  const [, KitAvailabilityLabels] =
    createAvailabilityLabels(availabilityConfigs);

  return (
    <div className="flex flex-col gap-1">
      <p className="word-break whitespace-break-spaces font-medium">
        {kit.name}{" "}
        <span className="text-[12px] font-normal text-gray-700">
          {isKitScanned ? (
            <>
              ({uncheckedKitAssetsInBooking.length} of {totalKitAssetsInBooking}{" "}
              assets to be checked out)
            </>
          ) : (
            <>
              ({remainingKitAssetsInBooking.length} of {totalKitAssetsInBooking}{" "}
              assets remaining)
            </>
          )}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={tw(
            "inline-block bg-gray-50 px-[6px] py-[2px]",
            "rounded-md border border-gray-200",
            "text-xs text-gray-700"
          )}
        >
          kit
        </span>
        <KitAvailabilityLabels />
      </div>
    </div>
  );
}

// Custom form component that handles early check-out dialog
type CustomFormProps = {
  assetIdsForCheckout: string[];
  /**
   * Per-slice qty payload (Wave B). Emitted alongside `assetIds[]` as a
   * single JSON-encoded `checkouts` hidden field — same pattern the
   * check-IN drawer uses for `checkins`.
   */
  checkoutsPayload: CheckoutDispositionInput[];
  isEarlyCheckout: boolean;
  booking: Pick<Booking, "id" | "name" | "from" | "to">;
  isLoading?: boolean;
  hasBlockers: boolean;
};

const CustomForm = ({
  assetIdsForCheckout,
  checkoutsPayload,
  isEarlyCheckout,
  booking,
  isLoading,
  hasBlockers,
}: CustomFormProps) => {
  /** Use state instead of ref so the component re-renders once the form
   * mounts — this guarantees portalContainer is always the real DOM node
   * when the user opens the early-checkout dialog. */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  return (
    <Form
      ref={setFormElement}
      id="partial-checkout-form"
      className="mb-4 flex max-h-full w-full"
      method="post"
    >
      <div className="flex w-full gap-2 p-3">
        {/* Hidden form fields */}
        {assetIdsForCheckout.map((assetId, index) => (
          <input
            key={`assetIds-${assetId}`}
            type="hidden"
            name={`assetIds[${index}]`}
            value={assetId}
          />
        ))}

        {/* Per-slice qty payload — only emit when there's at least one
            qty-tracked slice being checked out. Omitting the field
            entirely keeps the legacy back-compat path (INDIVIDUAL-only
            scans) byte-identical to before. */}
        {checkoutsPayload.length > 0 ? (
          <input
            type="hidden"
            name="checkouts"
            value={JSON.stringify(checkoutsPayload)}
          />
        ) : null}

        {/* Cancel button */}
        <Button type="button" variant="secondary" to=".." className="ml-auto">
          Cancel
        </Button>

        {/* Submit button - conditional based on early check-out */}
        {isEarlyCheckout ? (
          <CheckoutDialog
            booking={{
              id: booking.id,
              name: booking.name,
              from: booking.from,
            }}
            disabled={
              isLoading || hasBlockers || assetIdsForCheckout.length === 0
            }
            portalContainer={formElement || undefined}
            formId="partial-checkout-form"
            // CheckoutDialog's trigger defaults to `grow` (designed for the
            // full-width booking-header bar). Inside this drawer footer the
            // sibling Cancel is `w-auto`, so the default grow makes the
            // trigger stretch to fill the row. Match the non-early-checkout
            // branch's `w-auto` for visual parity.
            triggerClassName="w-auto"
          />
        ) : (
          <Button
            type="submit"
            disabled={
              isLoading || hasBlockers || assetIdsForCheckout.length === 0
            }
            className="w-auto"
          >
            Check out assets
          </Button>
        )}
      </div>
    </Form>
  );
};
