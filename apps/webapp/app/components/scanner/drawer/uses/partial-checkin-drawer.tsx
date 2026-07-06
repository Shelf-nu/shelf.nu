/**
 * Partial Check-in Drawer
 *
 * Drawer UI for the "Check in assets" scanner flow on an ONGOING /
 * OVERDUE booking. Ports the audit drawer's expected-list preview UX:
 * the drawer opens showing every asset on the booking (pending +
 * scanned + already-reconciled) so the operator has a complete picture
 * of what's outstanding instead of tracking it in their head.
 *
 * For QUANTITY_TRACKED assets (which lack physical barcodes and can't
 * be scanned in practice), each pending row exposes a "Check in
 * without scanning" button that inserts a synthetic scanned item with
 * a `qty-checkin:<assetId>` key — downstream logic (disposition
 * seeding, blockers, submit payload) treats it identically to a real
 * scan.
 *
 * Submit payload is byte-identical to the pre-refactor drawer — this
 * is a UX-only change on the client. Server contract
 * (`partialCheckinBooking`) is unchanged.
 *
 * @see {@link file://./../../../audit/audit-drawer.tsx} — gold-standard
 *   pattern being mirrored.
 * @see {@link file://./../../../atoms/qr-scanner.ts} —
 *   `bookingExpectedAssetsAtom`, `quickCheckinQtyAssetAtom`,
 *   `QUICK_CHECKIN_QR_PREFIX`.
 * @see {@link file://./../../../routes/_layout+/bookings.$bookingId.overview.checkin-assets.tsx}
 *   — loader that ships `expectedAssets` + `expectedKits`.
 */

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { AssetStatus } from "@prisma/client";
import type { Booking } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDownIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import { z } from "zod";
import type { BookingExpectedAsset } from "~/atoms/qr-scanner";
import {
  bookingExpectedAssetsAtom,
  clearScannedItemsAtom,
  quickCheckinQtyAssetAtom,
  QUICK_CHECKIN_QR_PREFIX,
  removeScannedItemAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import { AvailabilityBadge } from "~/components/booking/availability-label";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import CheckinDialog from "~/components/booking/checkin-dialog";
import { Form } from "~/components/custom-form";
import { CheckIcon } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Progress } from "~/components/shared/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview.checkin-assets";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { isAssetPartiallyCheckedIn } from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import {
  createAvailabilityLabels,
  kitLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { DefaultLoadingState, GenericItemRow, Tr } from "../generic-item-row";
import { PendingItemsList, SectionHeader } from "./pending-items-list";

/**
 * Shape of a single per-asset disposition submitted by the check-in drawer.
 *
 * - INDIVIDUAL assets: presence in the array means "checking this asset in".
 *   The disposition numeric fields are ignored for individuals.
 * - QUANTITY_TRACKED assets: at least one of returned/consumed/lost/damaged
 *   must be > 0, otherwise the asset is treated as a blocker (see drawer).
 *
 * `pending` is implicit — it's `remaining − (returned|consumed) − lost − damaged`.
 * Pending units write no log and keep the booking outstanding for another
 * check-in session.
 */
export const checkinDispositionSchema = z.object({
  assetId: z.string().min(1),
  /**
   * BookingAsset.id this disposition targets. Polish-6 lets one asset
   * have multiple slices (kit-driven + standalone) in the same booking;
   * tagging the slice lets the server write an exactly-attributed
   * `ConsumptionLog.bookingAssetId` instead of relying on greedy-fill on
   * read. Optional for back-compat: legacy / mobile / `assetIds`-only
   * callers omit it and the server falls back to asset-level handling.
   */
  bookingAssetId: z.string().min(1).optional(),
  /** TWO_WAY return count — writes a RETURN log, no pool change. */
  returned: z.number().int().nonnegative().optional(),
  /** ONE_WAY consumption count — writes a CONSUME log, pool decrements. */
  consumed: z.number().int().nonnegative().optional(),
  /** Units permanently missing — writes a LOSS log, pool decrements. */
  lost: z.number().int().nonnegative().optional(),
  /** Units returned but unusable — writes a DAMAGE log, pool decrements. */
  damaged: z.number().int().nonnegative().optional(),
});

export type CheckinDisposition = z.infer<typeof checkinDispositionSchema>;

/**
 * Internal drawer state for a qty-tracked asset's disposition inputs.
 *
 * All numeric inputs are tracked as strings so an empty field stays empty
 * (controlled `value=""`) instead of coercing to 0 and looking confusing.
 * We convert to numbers only at submit time.
 */
type QtyDispositionState = {
  /**
   * Primary input. Semantically either "Returned" (TWO_WAY) or
   * "Consumed" (ONE_WAY) — the drawer picks the label based on the
   * asset's consumptionType.
   */
  primary: string;
  /**
   * ONE_WAY shortfall: the subset of booked consumable units that the
   * operator is putting back to the pool instead of consuming. E.g.
   * booked 20 batteries, only 5 consumed, 15 returned unused.
   *
   * Unused for TWO_WAY — `primary` already holds the returned amount.
   */
  returned: string;
  lost: string;
  damaged: string;
};

/** Keyed by `bookingAssetId` (the slice), not `asset.id` — Polish-7b. */
type DispositionMap = Record<string, QtyDispositionState>;

/**
 * Context exposing per-slice disposition state down to the `AssetRow`
 * render function. Using context (not prop drilling) because `AssetRow`
 * is rendered via a callback passed to `ConfigurableDrawer`, making direct
 * prop passing awkward.
 *
 * Everything qty-related is keyed by `bookingAssetId` so two slices of
 * the same asset (kit-driven + standalone) are independent.
 */
type DispositionContextValue = {
  /** Map of bookingAssetId → per-slice disposition state. */
  dispositions: DispositionMap;
  /**
   * Per-slice `remaining` + `consumptionType` coming from the loader,
   * keyed by `bookingAssetId`. Empty when the booking has no qty-tracked
   * assets.
   */
  qtyRemainingByBookingAssetId: Record<
    string,
    {
      booked: number;
      logged: number;
      remaining: number;
      consumptionType: "ONE_WAY" | "TWO_WAY" | null;
    }
  >;
  updateField: (
    bookingAssetId: string,
    field: keyof QtyDispositionState,
    value: string
  ) => void;
  /**
   * When set to a bookingAssetId, the corresponding
   * {@link QuantityDispositionBlock} auto-focuses its primary input and
   * scrolls into view. Cleared by the caller shortly after so
   * re-renders don't keep stealing focus.
   */
  recentlyAddedBookingAssetId: string | null;
};

const DispositionContext = createContext<DispositionContextValue | null>(null);

function useDispositionContext(): DispositionContextValue {
  const ctx = useContext(DispositionContext);
  if (!ctx) {
    throw new Error(
      "useDispositionContext called outside of PartialCheckinDrawer"
    );
  }
  return ctx;
}

/**
 * Parse a disposition state into numeric fields. Empty strings become 0.
 * Used both for blocker detection (is-zero?) and for serializing the
 * submit payload.
 */
function parseDispositionState(state: QtyDispositionState | undefined) {
  const primary = Number(state?.primary ?? "");
  const returned = Number(state?.returned ?? "");
  const lost = Number(state?.lost ?? "");
  const damaged = Number(state?.damaged ?? "");
  return {
    primary: Number.isFinite(primary) ? primary : 0,
    returned: Number.isFinite(returned) ? returned : 0,
    lost: Number.isFinite(lost) ? lost : 0,
    damaged: Number.isFinite(damaged) ? damaged : 0,
  };
}

// Export the schema so it can be reused
export const partialCheckinAssetsSchema = z.object({
  /**
   * Legacy asset-id array — kept for backward compatibility with existing
   * scanner flows that don't carry per-asset quantities (e.g. individual
   * assets only). Present when no `checkins` JSON payload is submitted.
   */
  assetIds: z.array(z.string()).min(1).optional(),
  /**
   * Modern per-asset disposition payload — JSON-encoded to sidestep the
   * limits of form-encoded arrays-of-objects (same pattern the
   * manage-assets drawer uses for its `quantities` map).
   */
  checkins: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null || value === "") return undefined;
      try {
        const parsed = JSON.parse(value);
        const result = z.array(checkinDispositionSchema).safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid checkin disposition payload",
          });
          return z.NEVER;
        }
        return result.data;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "checkins is not valid JSON",
        });
        return z.NEVER;
      }
    }),
});

/** Narrowed type alias for readability below. */
type QtyExpectedAsset = Extract<
  BookingExpectedAsset,
  { kind: "QUANTITY_TRACKED" }
>;
type IndividualExpectedAsset = Extract<
  BookingExpectedAsset,
  { kind: "INDIVIDUAL" }
>;

/**
 * Derive the asset id for a scanned item. Both real scans and synthetic
 * quick-checkin entries carry `data.id` (the synthetic entry's suffix is
 * now a BookingAsset id, not an asset id — Polish-7b — so we always read
 * `data.id` rather than slicing the key).
 */
function assetIdForScannedKey(item: {
  data?: { id?: string } | null | undefined;
}): string | undefined {
  return item?.data?.id;
}

/**
 * Resolve the `BookingAsset` slice id a scanned item targets (Polish-7b).
 *
 * - Synthetic quick-checkin entry → the key suffix IS the bookingAssetId
 *   (also mirrored on `data.bookingAssetId`).
 * - Real qty scan → the asset's first still-PENDING qty slice. For a
 *   single-slice asset (the legacy / common case) that's the one slice,
 *   so behaviour is unchanged.
 *
 * Returns `undefined` for INDIVIDUAL assets (they don't carry per-slice
 * dispositions) and for qty assets with no pending slice.
 */
function bookingAssetIdForScannedItem(
  key: string,
  item: {
    data?: { id?: string; bookingAssetId?: string } | null | undefined;
  },
  expectedAssets: BookingExpectedAsset[]
): string | undefined {
  if (key.startsWith(QUICK_CHECKIN_QR_PREFIX)) {
    return key.slice(QUICK_CHECKIN_QR_PREFIX.length);
  }
  if (item?.data?.bookingAssetId) return item.data.bookingAssetId;
  const assetId = item?.data?.id;
  if (!assetId) return undefined;
  const slice = expectedAssets.find(
    (a) => a.kind === "QUANTITY_TRACKED" && a.id === assetId && a.remaining > 0
  );
  return slice?.bookingAssetId;
}

/**
 * Props required to render the booking header row at the top of the
 * drawer.
 *
 * Date fields are typed as `Date | string` because the loader serializes
 * them through React Router (`useLoaderData`). `DateS` accepts both, so
 * threading the wider shape avoids a `Pick<Booking, …>` mismatch when the
 * full `useLoaderData<typeof loader>().booking` is passed in.
 */
type BookingHeaderBooking = Pick<
  Booking,
  "id" | "name" | "status" | "custodianUserId"
> & {
  from: Date | string;
  to: Date | string;
};

/**
 * Renders the booking summary strip at the top of the partial check-in drawer.
 * Hoisted to module scope (instead of being a nested component) to avoid
 * remounting the header on every render of the parent drawer.
 */
function BookingHeader({
  booking,
}: {
  booking: BookingHeaderBooking;
}): ReactNode {
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
 * Drawer component for managing scanned assets to be checked in from bookings
 */
// react-doctor:no-giant-component — deferred for follow-up refactor
export default function PartialCheckinDrawer({
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
    partialCheckinProgress,
    partialCheckinDetails,
    qtyRemainingByAssetId,
    qtyRemainingByBookingAssetId,
    expectedKits,
  } = useLoaderData<typeof loader>();

  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const expectedAssets = useAtomValue(bookingExpectedAssetsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);
  const quickCheckinQtyAsset = useSetAtom(quickCheckinQtyAssetAtom);

  /**
   * BookingAsset id of the most-recently-added quick-checkin row. The
   * corresponding {@link QuantityDispositionBlock} auto-focuses + scrolls
   * into view when it mounts. Cleared after ~600ms by the click handler
   * so subsequent re-renders don't re-steal focus.
   */
  const [recentlyAddedBookingAssetId, setRecentlyAddedBookingAssetId] =
    useState<string | null>(null);
  const recentlyAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Cancel any pending clear on unmount so we don't call setState on a
  // dead component.
  useEffect(
    () => () => {
      if (recentlyAddedTimerRef.current) {
        clearTimeout(recentlyAddedTimerRef.current);
      }
    },
    []
  );

  /**
   * Per-slice disposition state. Keyed by `bookingAssetId` (Polish-7b).
   * Populated on-demand when a qty-tracked slice is scanned / quick-checked
   * (see effect below). Primary defaults to the remaining count so the
   * happy-path is "scan and submit".
   */
  const [dispositions, setDispositions] = useState<DispositionMap>({});

  const updateField = useCallback(
    (
      bookingAssetId: string,
      field: keyof QtyDispositionState,
      value: string
    ) => {
      setDispositions((prev) => ({
        ...prev,
        [bookingAssetId]: {
          primary: prev[bookingAssetId]?.primary ?? "",
          returned: prev[bookingAssetId]?.returned ?? "",
          lost: prev[bookingAssetId]?.lost ?? "",
          damaged: prev[bookingAssetId]?.damaged ?? "",
          [field]: value,
        },
      }));
    },
    []
  );

  // Filter and prepare data for component rendering
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // List of asset IDs for the form - only include assets that are actually in the booking
  const bookingAssetIds = new Set(
    booking.bookingAssets.map((ba) => ba.assetId)
  );

  // Get assets that have already been checked in (should be excluded from count)
  const checkedInAssetIds = new Set(
    partialCheckinProgress?.checkedInAssetIds || []
  );

  /**
   * Unit-aware "is this asset checkable in?" predicate.
   *
   * INDIVIDUAL assets: classic binary gate — the asset must be
   * CHECKED_OUT to be eligible (a still-Booked asset was never
   * scanned out, so it can't be checked in).
   *
   * QUANTITY_TRACKED assets: gate on remaining units, NOT
   * `asset.status`. A QT asset reached via progressive partial
   * checkouts may sit at any unit-level state (partially-out,
   * fully-out, even refreshed-to-zero by an earlier check-in). The
   * authoritative signal is "are there units still outstanding to
   * check back in?" — i.e. `qtyRemainingByAssetId[asset.id].remaining > 0`.
   *
   * Defensive fallback: when the loader didn't ship
   * `qtyRemainingByAssetId` (legacy / pre-Wave-B tests), fall back
   * to the binary gate so existing component tests keep passing.
   *
   * Accepts the narrowest shape both scanned-asset payloads
   * (standalone `AssetFromQr` and kit-member `assetKits[*].asset`)
   * are guaranteed to provide — `id` and `status`.
   */
  const isAssetCheckable = (a: {
    id: string;
    status: AssetStatus;
  }): boolean => {
    if (!bookingAssetIds.has(a.id) || checkedInAssetIds.has(a.id)) {
      return false;
    }
    const qtyInfo = qtyRemainingByAssetId?.[a.id];
    if (qtyInfo) {
      return qtyInfo.remaining > 0;
    }
    return a.status === AssetStatus.CHECKED_OUT;
  };

  // Only assets that have units still outstanding (QT) or were
  // actually checked out (INDIVIDUAL) can be checked in. This excludes
  // still-Booked / fully-reconciled assets from the submit payload —
  // they are surfaced to the user via a blocker instead (progressive
  // checkout guard).
  const assetIdsForCheckin = Array.from(
    new Set([
      ...assets.filter(isAssetCheckable).map((a) => a.id),
      ...kits.flatMap((k) =>
        k.assetKits
          .map((ak) => ak.asset)
          .filter(isAssetCheckable)
          .map((a) => a.id)
      ),
    ])
  );

  /**
   * Map `bookingAssetId → assetId` from the expected list. Used to label
   * the `checkins` payload entries (which the server keys by assetId for
   * type routing) while the drawer keys everything by slice.
   */
  const assetIdByBookingAssetId = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of expectedAssets) m.set(a.bookingAssetId, a.id);
    return m;
  }, [expectedAssets]);

  /**
   * Activation set (Polish-7b): the `bookingAssetId`s of qty-tracked
   * SLICES put in play this session — via a real scan resolved to the
   * asset's pending slice, a quick-checkin synthetic entry (keyed by the
   * slice), or a scanned kit covering a kit-driven slice. Only slices
   * with `remaining > 0` qualify. `qrIdByBookingAssetId` lets blockers map
   * a slice back to the scanned-item key that activated it.
   */
  const { activatedQtyBookingAssetIds, qrIdByBookingAssetId } = useMemo(() => {
    const activated = new Set<string>();
    const qrIdByBaId = new Map<string, string>();
    const activate = (baId: string | undefined, qrId: string) => {
      if (!baId) return;
      const info = qtyRemainingByBookingAssetId?.[baId];
      if (!info || info.remaining <= 0) return;
      activated.add(baId);
      if (!qrIdByBaId.has(baId)) qrIdByBaId.set(baId, qrId);
    };

    for (const [qrId, item] of Object.entries(items)) {
      if (!item || item.error) continue;
      if (item.type === "asset") {
        activate(
          bookingAssetIdForScannedItem(qrId, item, expectedAssets),
          qrId
        );
        continue;
      }
      // A scanned kit covers its members: activate each kit-driven qty
      // slice whose own `kitId` matches the scanned kit. The kit payload
      // exposes `assetKits` (not a flat `assets` list), but the per-slice
      // `kitId` from the loader is the authoritative link — so we match on
      // that alone rather than the kit's member-id list.
      if (item.type === "kit" && item.data) {
        const kitId = (item.data as { id?: string }).id;
        if (kitId) {
          for (const a of expectedAssets) {
            if (a.kind === "QUANTITY_TRACKED" && a.kitId === kitId) {
              activate(a.bookingAssetId, qrId);
            }
          }
        }
      }
    }
    return {
      activatedQtyBookingAssetIds: activated,
      qrIdByBookingAssetId: qrIdByBaId,
    };
  }, [items, expectedAssets, qtyRemainingByBookingAssetId]);

  /**
   * Keep the disposition map in sync with the current activation set:
   *
   * 1. Drop entries for slices no longer activated (the user removed the
   *    scan via the trash icon) so a re-scan doesn't restore stale typed
   *    values.
   * 2. Seed newly-activated slices with their remaining quantity so the
   *    happy-path is "scan and submit". Existing entries are preserved so
   *    typing isn't lost as other scans arrive.
   *
   * Returns the previous reference when nothing changed to avoid
   * pointless re-renders.
   */
  useEffect(() => {
    setDispositions((prev) => {
      let changed = false;
      let next: DispositionMap = {};

      for (const [baId, state] of Object.entries(prev)) {
        if (activatedQtyBookingAssetIds.has(baId)) {
          next[baId] = state;
        } else {
          changed = true;
        }
      }

      for (const baId of activatedQtyBookingAssetIds) {
        if (next[baId]) continue;
        const info = qtyRemainingByBookingAssetId?.[baId];
        if (!info) continue;
        next = {
          ...next,
          [baId]: {
            primary: String(info.remaining),
            returned: "",
            lost: "",
            damaged: "",
          },
        };
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [activatedQtyBookingAssetIds, qtyRemainingByBookingAssetId]);

  // Check if this would be a final check-in (all remaining assets are being checked in)
  const remainingAssetCount =
    partialCheckinProgress?.uncheckedCount || booking.bookingAssets.length;
  const isFinalCheckin =
    assetIdsForCheckin.length === remainingAssetCount &&
    remainingAssetCount > 0;

  // Check if it's an early check-in (only relevant for final check-ins)
  const isEarlyCheckin = Boolean(
    isFinalCheckin && isBookingEarlyCheckin(booking.to)
  );

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers - only assets NOT in this booking
  const assetsNotInBookingIds = assets
    .filter((asset) => !bookingAssetIds.has(asset.id))
    .map((a) => a.id);

  // Assets that are already checked in for this booking
  const alreadyCheckedInAssets = assets
    .filter(
      (asset) =>
        bookingAssetIds.has(asset.id) &&
        isAssetPartiallyCheckedIn(asset, partialCheckinDetails, booking.status)
    )
    .map((a) => a.id);

  const qrIdsOfAlreadyCheckedInAssets = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "asset") return false;
      return alreadyCheckedInAssets.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  /**
   * Unit-aware "never checked out" predicate (mirrors
   * {@link isAssetCheckable} above, inverted).
   *
   * INDIVIDUAL: flag when `asset.status !== CHECKED_OUT` — never
   * scanned out, so can't be checked in.
   *
   * QUANTITY_TRACKED: flag when `qtyRemainingByAssetId[id].remaining <= 0`
   * AND no partial-checkin record exists. Crucially, do NOT consult
   * `asset.status` for QT assets: a partially-out QT asset (e.g. 30
   * of 50 units out) the user wants to top-off-check-in might still
   * carry an AVAILABLE / partially-out aggregate status while having
   * units outstanding, and the binary check would wrongly block it.
   *
   * Defensive fallback: when `qtyRemainingByAssetId` is absent
   * (legacy / pre-Wave-B tests), fall back to the binary gate.
   */
  const isAssetNeverCheckedOut = (asset: {
    id: string;
    status: AssetStatus;
  }): boolean => {
    if (!bookingAssetIds.has(asset.id)) return false;
    if (isAssetPartiallyCheckedIn(asset, partialCheckinDetails, booking.status))
      return false;
    const qtyInfo = qtyRemainingByAssetId?.[asset.id];
    if (qtyInfo) {
      return qtyInfo.remaining <= 0;
    }
    return asset.status !== AssetStatus.CHECKED_OUT;
  };

  // Progressive checkout guard: an asset can only be checked IN if it was first
  // checked OUT. A still-Booked (not CHECKED_OUT) asset that is part of this
  // booking was never scanned out, so it cannot be checked in. We only flag
  // assets that ARE in the booking (the not-in-booking blocker handles the rest)
  // and are NOT already checked in (that has its own blocker).
  // Consider BOTH standalone scans and kit-member assets — scanning a kit QR
  // queues its assets, so a kit whose in-booking assets were never checked out
  // must surface a blocker too (otherwise submit is silently disabled).
  const scannedBookingAssets = [
    ...assets,
    ...kits.flatMap((kit) => kit.assetKits.map((ak) => ak.asset)),
  ].filter(isAssetNeverCheckedOut);
  const neverCheckedOutAssetIds = [
    ...new Set(scannedBookingAssets.map((a) => a.id)),
  ];
  const neverCheckedOutAssetIdSet = new Set(neverCheckedOutAssetIds);

  const qrIdsOfNeverCheckedOutAssets = Object.entries(items)
    .filter(([, item]) => {
      if (!item) return false;
      if (item.type === "asset") {
        return neverCheckedOutAssetIdSet.has((item?.data as any)?.id);
      }
      if (item.type === "kit") {
        return (item?.data as any)?.assets?.some((a: { id: string }) =>
          neverCheckedOutAssetIdSet.has(a.id)
        );
      }
      return false;
    })
    .map(([qrId]) => qrId);

  // Note: In partial check-in context, we allow individual kit assets to be checked in
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

  // Kits that are already checked in for this booking (ALL kit assets in booking are checked in)
  const alreadyCheckedInKits = kits
    .filter((kit) => {
      // Get kit assets that are in this booking
      const kitAssetsInBooking = kit.assetKits
        .map((ak) => ak.asset)
        .filter((asset) => bookingAssetIds.has(asset.id));

      // Kit is considered already checked in only if ALL its assets in booking are checked in
      return (
        kitAssetsInBooking.length > 0 &&
        kitAssetsInBooking.every((asset) =>
          isAssetPartiallyCheckedIn(
            asset,
            partialCheckinDetails,
            booking.status
          )
        )
      );
    })
    .map((kit) => kit.id);

  const qrIdsOfAlreadyCheckedInKits = Object.entries(items)
    .filter(([_qrId, item]) => {
      if (!item || item.type !== "kit") return false;
      const kitId = (item?.data as any)?.id;
      const isAlreadyCheckedIn = alreadyCheckedInKits.includes(kitId);

      return isAlreadyCheckedIn;
    })
    .map(([qrId]) => qrId);

  // Assets that are redundant because their kit is also scanned
  const redundantAssetIds: string[] = [];
  const qrIdsOfRedundantAssets: string[] = [];

  // Check for assets that belong to scanned kits
  assets.forEach((asset) => {
    // Optional chaining on `assetKits` itself keeps stale fixtures that
    // never populated the relation from crashing the drawer.
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

  /**
   * Phase 3c: qty-tracked assets that were scanned but have zero
   * disposition entered across all inputs (primary + lost + damaged).
   * Blocks submission — matches the existing "you must do something with
   * this" pattern of other blockers. Resolvable either by entering a
   * value or removing the scan.
   */
  // Keyed by `bookingAssetId` (Polish-7b) — one entry per activated slice
  // with no disposition entered. Mapped back to the scanned-item qrId for
  // resolution via `qrIdByBookingAssetId`.
  const zeroDispositionQtyIds = [...activatedQtyBookingAssetIds].filter(
    (baId) => {
      const parsed = parseDispositionState(dispositions[baId]);
      // Include `returned` — a ONE_WAY asset with only a Returned
      // entry is non-zero, even if the primary (Consumed) is 0.
      return (
        parsed.primary + parsed.returned + parsed.lost + parsed.damaged === 0
      );
    }
  );
  const qrIdsOfZeroDispositionQty = zeroDispositionQtyIds
    .map((baId) => qrIdByBookingAssetId.get(baId))
    .filter((qrId): qrId is string => Boolean(qrId));

  /**
   * Also flag over-return: if the entered total exceeds the slice's
   * remaining count, the server will reject the submission. Surface it
   * client-side so the user can fix before hitting submit. Per-slice.
   */
  const overReturnQtyIds = [...activatedQtyBookingAssetIds].filter((baId) => {
    const info = qtyRemainingByBookingAssetId?.[baId];
    if (!info) return false;
    const parsed = parseDispositionState(dispositions[baId]);
    return (
      parsed.primary + parsed.returned + parsed.lost + parsed.damaged >
      info.remaining
    );
  });
  const qrIdsOfOverReturnQty = overReturnQtyIds
    .map((baId) => qrIdByBookingAssetId.get(baId))
    .filter((qrId): qrId is string => Boolean(qrId));

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
      condition: alreadyCheckedInAssets.length > 0,
      count: alreadyCheckedInAssets.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s have" : " has"}`}</strong>{" "}
          already been checked in for this booking.
        </>
      ),
      description: "These assets cannot be checked in again",
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyCheckedInAssets),
    },
    {
      condition: neverCheckedOutAssetIds.length > 0,
      count: neverCheckedOutAssetIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${
            count > 1 ? "s haven't" : " hasn't"
          }`}</strong>{" "}
          been checked out yet and can't be checked in.
        </>
      ),
      description:
        "Only assets that were checked out can be checked back in. Check these out first.",
      onResolve: () => removeItemsFromList(qrIdsOfNeverCheckedOutAssets),
    },
    {
      condition: alreadyCheckedInKits.length > 0,
      count: alreadyCheckedInKits.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s have" : " has"}`}</strong>{" "}
          already been checked in for this booking.
        </>
      ),
      description: "All assets from these kits have already been checked in",
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyCheckedInKits),
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
    {
      condition: zeroDispositionQtyIds.length > 0,
      count: zeroDispositionQtyIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} quantity-tracked asset${
            count > 1 ? "s have" : " has"
          }`}</strong>{" "}
          no quantity entered.
        </>
      ),
      description:
        "Enter a returned / consumed / lost / damaged quantity — remove the scan, or click Check in on the pending row.",
      onResolve: () => removeItemsFromList(qrIdsOfZeroDispositionQty),
    },
    {
      condition: overReturnQtyIds.length > 0,
      count: overReturnQtyIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} quantity-tracked asset${
            count > 1 ? "s exceed" : " exceeds"
          }`}</strong>{" "}
          the remaining quantity on this booking.
        </>
      ),
      description:
        "Reduce the entered values to match what's remaining — or remove the scan.",
      onResolve: () => removeItemsFromList(qrIdsOfOverReturnQty),
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
        ...qrIdsOfAlreadyCheckedInAssets,
        ...qrIdsOfNeverCheckedOutAssets,
        ...qrIdsOfAlreadyCheckedInKits,
        ...qrIdsOfZeroDispositionQty,
        ...qrIdsOfOverReturnQty,
      ]);
    },
  });

  /**
   * Serialize the per-asset dispositions into the `checkins` JSON
   * payload. Only included when at least one qty-tracked asset is in
   * play; otherwise the form submits the legacy `assetIds` array.
   */
  const checkinsJson = useMemo(() => {
    if (activatedQtyBookingAssetIds.size === 0) return "";
    const payload: CheckinDisposition[] = [...activatedQtyBookingAssetIds].map(
      (baId) => {
        const state = dispositions[baId];
        const parsed = parseDispositionState(state);
        const info = qtyRemainingByBookingAssetId?.[baId];
        const assetId = assetIdByBookingAssetId.get(baId) ?? "";
        const isOneWay = info?.consumptionType === "ONE_WAY";
        /**
         * `bookingAssetId` lets the server attribute the disposition to the
         * exact slice (Polish-7b). ONE_WAY: `primary` holds the Consumed
         * count; the `returned` shortfall input holds units returned to the
         * pool unused. TWO_WAY: `primary` is the Returned count.
         */
        return {
          assetId,
          bookingAssetId: baId,
          ...(isOneWay
            ? { consumed: parsed.primary, returned: parsed.returned }
            : { returned: parsed.primary }),
          lost: parsed.lost,
          damaged: parsed.damaged,
        };
      }
    );
    return JSON.stringify(payload);
  }, [
    activatedQtyBookingAssetIds,
    dispositions,
    qtyRemainingByBookingAssetId,
    assetIdByBookingAssetId,
  ]);

  const dispositionCtxValue = useMemo<DispositionContextValue>(
    () => ({
      dispositions,
      qtyRemainingByBookingAssetId: qtyRemainingByBookingAssetId ?? {},
      updateField,
      recentlyAddedBookingAssetId,
    }),
    [
      dispositions,
      qtyRemainingByBookingAssetId,
      updateField,
      recentlyAddedBookingAssetId,
    ]
  );

  /**
   * Set of asset ids that are currently represented in the scanned
   * items (whether via real scan or quick-checkin key). Used to
   * classify expected assets into the "scanned" vs "pending" buckets.
   */
  const scannedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of Object.values(items)) {
      if (!item) continue;
      if (item.type === "asset") {
        const id = assetIdForScannedKey(item as { data?: { id?: string } });
        if (id) ids.add(id);
        continue;
      }
      /**
       * Scanning a kit QR counts as "I've got all the assets in this
       * kit". The pending / progress logic has to honour that —
       * otherwise the kit row lands in "Checked in this session" but
       * each of its child assets still shows up under Pending, and
       * `0/N units checked in` stays unchanged.
       *
       * We read the member list from the kit payload the scanner API
       * already fetched (`KIT_INCLUDE` selects `assetKits: { asset: {id} }`),
       * not from `expectedKits`, so kits that aren't on the booking still
       * get handled consistently (their assets aren't in `expectedAssets`,
       * so the pending loop simply ignores them).
       */
      if (item.type === "kit" && item.data) {
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

  /**
   * Bucket expected assets into the render groups described in
   * `twinkly-mixing-pelican.md §C`. Order matters — the drawer renders
   * them in this sequence:
   *
   * 1. scannedWithPending  — qty rows with a scan but sum < remaining
   * 2. scannedComplete     — INDIVIDUAL scans, or qty rows fully filled
   * 3. unexpectedScans     — scans whose asset id isn't on the booking
   * 4. pendingIndividuals  — expected INDIVIDUAL, not yet scanned
   * 5. pendingQtyTracked   — expected QTY_TRACKED with remaining > 0
   *                          (includes partially-reconciled; badge
   *                          varies by `logged`)
   * 6. alreadyReconciled   — INDIVIDUAL alreadyCheckedIn, or qty rows
   *                          with remaining === 0 (bottom, dimmed)
   *
   * Notes:
   *  - Unexpected scans are not in `expectedAssets`, so we derive them
   *    separately from `items`.
   *  - Pending rows never appear in `scannedItemsAtom`, so blockers
   *    (which walk `items`) are unaffected.
   */
  const buckets = useMemo(() => {
    const scannedWithPending: Array<{ qrId: string; asset: QtyExpectedAsset }> =
      [];
    const scannedComplete: Array<{ qrId: string; kind: "asset" | "kit" }> = [];
    const unexpectedScans: string[] = [];
    const pendingIndividuals: IndividualExpectedAsset[] = [];
    const pendingQtyTracked: QtyExpectedAsset[] = [];
    const alreadyReconciled: BookingExpectedAsset[] = [];

    // Index expected assets by id (INDIVIDUAL / unexpected lookup, 1:1)
    // and by bookingAssetId (qty slices — Polish-7b).
    const expectedById = new Map<string, BookingExpectedAsset>();
    const expectedByBookingAssetId = new Map<string, BookingExpectedAsset>();
    for (const a of expectedAssets) {
      expectedById.set(a.id, a);
      expectedByBookingAssetId.set(a.bookingAssetId, a);
    }

    // First pass: walk scanned items to classify scanned buckets.
    for (const [qrId, item] of Object.entries(items)) {
      if (!item) continue;
      if (item.error) {
        // Error rows (bad QR, duplicate, etc.) render via the default
        // scanned path — they're surfaced by blockers.
        scannedComplete.push({
          qrId,
          kind: item.type === "kit" ? "kit" : "asset",
        });
        continue;
      }
      if (item.type === "kit") {
        // Kits don't have an `expectedAssets` entry — they're always
        // rendered as "scanned" rows (the existing `KitRow` handles its
        // own availability badges).
        scannedComplete.push({ qrId, kind: "kit" });
        continue;
      }
      if (item.type !== "asset") {
        // Unresolved scan: the scanner input just posted the qrId but
        // the `/api/get-scanned-item/<id>` fetch hasn't returned yet,
        // so `type` and `data` aren't set. Render as a scanned row
        // anyway so `GenericItemRow` mounts and fires the fetch —
        // otherwise the item is silently invisible (no type → skipped
        // here → never rendered → API never called → never resolves).
        // Once the API responds, `updateScannedItemAtom` sets
        // `type: "asset"` and this bucket sort re-runs and classifies
        // the row properly.
        scannedComplete.push({ qrId, kind: "asset" });
        continue;
      }

      // Qty slice? Resolve the bookingAssetId this scan targets and
      // classify against THAT slice's remaining (Polish-7b).
      const baId = bookingAssetIdForScannedItem(
        qrId,
        item as { data?: { id?: string; bookingAssetId?: string } },
        expectedAssets
      );
      const slice = baId ? expectedByBookingAssetId.get(baId) : undefined;
      if (baId && slice && slice.kind === "QUANTITY_TRACKED") {
        const parsed = parseDispositionState(dispositions[baId]);
        const sum =
          parsed.primary + parsed.returned + parsed.lost + parsed.damaged;
        if (slice.remaining > 0 && sum < slice.remaining) {
          scannedWithPending.push({ qrId, asset: slice });
        } else {
          scannedComplete.push({ qrId, kind: "asset" });
        }
        continue;
      }

      // INDIVIDUAL scan (or qty asset with no pending slice — edge case,
      // treat as complete). Resolve the plain asset id.
      const assetId = assetIdForScannedKey(item as { data?: { id?: string } });
      if (!assetId) {
        scannedComplete.push({ qrId, kind: "asset" });
        continue;
      }
      const expected = expectedById.get(assetId);
      if (!expected) {
        unexpectedScans.push(qrId);
        continue;
      }
      scannedComplete.push({ qrId, kind: "asset" });
    }

    // Second pass: walk expected assets for pending + already-reconciled
    // buckets.
    for (const asset of expectedAssets) {
      if (asset.kind === "INDIVIDUAL") {
        // Skip individuals already scanned this session (asset-level).
        if (scannedAssetIds.has(asset.id)) continue; // covered above
        if (asset.alreadyCheckedIn) {
          alreadyReconciled.push(asset);
        } else {
          pendingIndividuals.push(asset);
        }
        continue;
      }

      // QUANTITY_TRACKED — per-slice (Polish-7b). Skip the slice if it was
      // activated this session (it renders in the scanned buckets above);
      // a sibling slice of the SAME asset stays independently pending.
      if (activatedQtyBookingAssetIds.has(asset.bookingAssetId)) continue;
      if (asset.remaining === 0) {
        alreadyReconciled.push(asset);
      } else {
        pendingQtyTracked.push(asset);
      }
    }

    return {
      scannedWithPending,
      scannedComplete,
      unexpectedScans,
      pendingIndividuals,
      pendingQtyTracked,
      alreadyReconciled,
    };
  }, [
    expectedAssets,
    items,
    dispositions,
    scannedAssetIds,
    activatedQtyBookingAssetIds,
  ]);

  /**
   * Unit-weighted progress: each INDIVIDUAL asset counts for 1, each
   * QUANTITY_TRACKED asset counts for its `booked` quantity. The
   * numerator sums reconciled individuals + (logged + typed
   * disposition) for qty-tracked, capped at `booked` per row.
   */
  const progress = useMemo(() => {
    let denom = 0;
    let num = 0;

    for (const asset of expectedAssets) {
      if (asset.kind === "INDIVIDUAL") {
        denom += 1;
        if (asset.alreadyCheckedIn || scannedAssetIds.has(asset.id)) {
          num += 1;
        }
        continue;
      }

      // QUANTITY_TRACKED — per-slice (keyed by bookingAssetId).
      denom += asset.booked;
      const parsed = parseDispositionState(dispositions[asset.bookingAssetId]);
      const typed =
        parsed.primary + parsed.returned + parsed.lost + parsed.damaged;
      const reconciled = Math.min(asset.booked, asset.logged + typed);
      num += reconciled;
    }

    return { num, denom };
  }, [expectedAssets, scannedAssetIds, dispositions]);

  // (BookingHeader is defined at module scope above — no nested component
  // here so we don't shadow it or remount on every render.)

  // Stable callback reference for the row's onRemove — keeps the
  // extracted `ScannedItemRow` component's prop identity stable across
  // renders so React can reconcile it in place.
  const onRemoveScanned = removeItem;

  /**
   * Invoked when the user clicks "Check in without scanning" on a
   * pending qty row. Dispatches the synthetic-scan atom, flags the
   * slice's bookingAssetId for auto-focus, then clears the flag after
   * 600ms so subsequent re-renders don't keep stealing focus.
   */
  const handleQuickCheckin = useCallback(
    (asset: QtyExpectedAsset) => {
      quickCheckinQtyAsset(asset);
      setRecentlyAddedBookingAssetId(asset.bookingAssetId);
      if (recentlyAddedTimerRef.current) {
        clearTimeout(recentlyAddedTimerRef.current);
      }
      recentlyAddedTimerRef.current = setTimeout(() => {
        setRecentlyAddedBookingAssetId(null);
      }, 600);
    },
    [quickCheckinQtyAsset]
  );

  /**
   * Map kitId → kit meta. Both the pending and reconciled sections group
   * qty + individual entries by each expected-asset's OWN `kitId` (the
   * per-slice attribution set by the loader). The distinction matters for
   * Polish-6 multi-row qty assets: a standalone slice carries
   * `kitId = null` and must NOT be absorbed into the kit group just
   * because the asset also has a kit-driven slice elsewhere in the
   * booking.
   */
  const kitMetaById = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; mainImage: string | null }
    >();
    for (const kit of expectedKits ?? []) {
      map.set(kit.id, {
        id: kit.id,
        name: kit.name,
        mainImage: kit.mainImage ?? null,
      });
    }
    return map;
  }, [expectedKits]);

  /**
   * Unified renderer: interleave all buckets in the order described on
   * `buckets`. Pending buckets render via their own `Tr`-wrapped
   * components; scanned buckets render through `GenericItemRow` which
   * uses its own `Tr`.
   */
  const customRenderAllItems = useCallback((): ReactNode => {
    const {
      scannedWithPending,
      scannedComplete,
      unexpectedScans,
      pendingIndividuals,
      pendingQtyTracked,
      alreadyReconciled,
    } = buckets;

    // Build the ordered scanned-row list keyed by qrId so we don't
    // double-render if a qrId appears in multiple buckets (shouldn't
    // happen, but be defensive).
    const scannedQrIdsInOrder: string[] = [];
    const seen = new Set<string>();
    const pushScanned = (qrId: string) => {
      if (seen.has(qrId)) return;
      seen.add(qrId);
      scannedQrIdsInOrder.push(qrId);
    };
    for (const { qrId } of scannedWithPending) pushScanned(qrId);
    for (const { qrId } of scannedComplete) pushScanned(qrId);
    for (const qrId of unexpectedScans) pushScanned(qrId);

    const scannedCount = scannedQrIdsInOrder.length;
    const pendingCount = pendingIndividuals.length + pendingQtyTracked.length;

    return (
      <>
        {/* Header for scanned section — only render when non-empty so
            an empty drawer doesn't show a "Checked in (0)" label. */}
        {scannedCount > 0 ? (
          <SectionHeader
            label={`Checked in this session (${scannedCount})`}
            tone="active"
          />
        ) : null}

        {/* Scanned rows (buckets 1–3). A scanned kit also renders an
            editable disposition row for each of its qty-tracked members
            (Polish-7b) so the operator can split their consumption log —
            individuals are covered by the kit row's summary. */}
        {scannedQrIdsInOrder.map((qrId) => {
          const item = items[qrId];
          const kitId =
            item?.type === "kit"
              ? (item.data as { id?: string } | undefined)?.id
              : undefined;
          const qtyMembers = kitId
            ? expectedAssets.filter(
                (a): a is QtyExpectedAsset =>
                  a.kind === "QUANTITY_TRACKED" &&
                  a.kitId === kitId &&
                  activatedQtyBookingAssetIds.has(a.bookingAssetId)
              )
            : [];
          return (
            <Fragment key={qrId}>
              <ScannedItemRow
                qrId={qrId}
                item={item}
                onRemove={onRemoveScanned}
              />
              {qtyMembers.map((member) => (
                <ScannedKitQtyMemberRow
                  key={`scanned-kit-qty-${member.bookingAssetId}`}
                  asset={member}
                />
              ))}
            </Fragment>
          );
        })}

        {/**
         * Pending section (Polish-7b — grouped by each entry's OWN
         * `kitId`, the per-slice attribution from the loader):
         *  1. Kit groups — one foldable header, child rows indented.
         *     Children are individuals (no action) AND qty slices (with
         *     the "Check in without scanning" affordance). A qty asset's
         *     kit-driven slice lands here; its standalone slice does not.
         *  2. Loose individuals (`kitId == null`).
         *  3. Loose qty slices (`kitId == null` — e.g. the standalone
         *     slice of an asset that's also in a kit).
         *
         * Renderer lives in `pending-items-list.tsx` so the check-out
         * drawer can reuse it under `mode="checkout"`.
         */}
        <PendingItemsList
          mode="checkin"
          pendingIndividuals={pendingIndividuals}
          pendingQtyTracked={pendingQtyTracked}
          kitMetaById={kitMetaById}
          onQuickAction={handleQuickCheckin}
          pendingCount={pendingCount}
        />

        {/* Bucket 6: already fully reconciled (dimmed, collapsed). */}
        {alreadyReconciled.length > 0 ? (
          <AlreadyReconciledCollapser
            assets={alreadyReconciled}
            kitMetaById={kitMetaById}
          />
        ) : null}
      </>
    );
  }, [
    buckets,
    items,
    expectedAssets,
    activatedQtyBookingAssetIds,
    kitMetaById,
    handleQuickCheckin,
    onRemoveScanned,
  ]);

  const progressLabel = (
    <div className="text-right">
      <span className="block text-gray-600">
        {progress.denom > 0
          ? `${progress.num}/${progress.denom} units checked in`
          : "No assets in this booking"}
      </span>
      <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
        <Progress
          value={progress.denom > 0 ? (progress.num / progress.denom) * 100 : 0}
        />
      </span>
    </div>
  );

  return (
    <DispositionContext.Provider value={dispositionCtxValue}>
      <ConfigurableDrawer
        schema={partialCheckinAssetsSchema}
        items={items}
        onClearItems={clearList}
        form={
          <CustomForm
            assetIdsForCheckin={assetIdsForCheckin}
            isEarlyCheckin={isEarlyCheckin}
            booking={booking}
            isLoading={isLoading}
            hasBlockers={hasBlockers}
            checkinsJson={checkinsJson}
          />
        }
        title={progressLabel}
        isLoading={isLoading}
        customRenderAllItems={customRenderAllItems}
        // Render body even when nothing has been scanned yet — pending
        // rows still need to be visible so the operator knows what's
        // expected.
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
    </DispositionContext.Provider>
  );
}

/**
 * Shared Tailwind class vocabulary for the little "asset"/"kit" pill
 * next to the row title. Kept in one place so the pending rows and the
 * scanned rows look identical.
 */
const assetTypePillClass = tw(
  "inline-block bg-gray-50 px-[6px] py-[2px]",
  "rounded-md border border-gray-200",
  "text-xs text-gray-700"
);

/**
 * Module-scope renderer for a single scanned row — promoted out of the
 * inline `renderScannedItemRow` useCallback so React can reconcile it
 * as a stable component (react-doctor `no-render-in-render`). Branches
 * on `item.type` to pick between the asset and kit shells; rendering
 * loading + error states is delegated to `DefaultLoadingState`.
 */
function ScannedItemRow({
  qrId,
  item,
  onRemove,
}: {
  qrId: string;
  item: any;
  onRemove: (qrId: string) => void;
}) {
  return (
    <GenericItemRow
      key={qrId}
      qrId={qrId}
      item={item}
      onRemove={onRemove}
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
}

/**
 * Collapser wrapping the "already fully reconciled" rows at the bottom
 * of the drawer. Closed by default — the operator usually only cares
 * about what's still outstanding.
 */
function AlreadyReconciledCollapser({
  assets,
  kitMetaById,
}: {
  assets: BookingExpectedAsset[];
  kitMetaById: Map<
    string,
    { id: string; name: string; mainImage: string | null }
  >;
}) {
  // `<details>` doesn't make sense inside a <tbody>, so we fall back
  // to a button-toggled state.
  const [open, setOpen] = useState(false);

  /**
   * Group reconciled assets by kit (mirror of the pending section) so a
   * checked-in kit reads as one unit instead of N scattered green rows.
   * Grouping keys off each entry's OWN `kitId` (per-slice attribution),
   * NOT the asset's kit membership — so a standalone qty slice stays a
   * loose row even when the same asset has a kit-driven slice elsewhere.
   * Loose (non-kit) assets render flat after the kit groups.
   */
  const { kitGroups, looseAssets } = useMemo(() => {
    const groups = new Map<
      string,
      {
        kit: { id: string; name: string; mainImage: string | null };
        assets: BookingExpectedAsset[];
      }
    >();
    const loose: BookingExpectedAsset[] = [];
    for (const asset of assets) {
      const kitId = asset.kitId ?? null;
      const kit = kitId ? kitMetaById.get(kitId) : null;
      if (!kit) {
        loose.push(asset);
        continue;
      }
      const existing = groups.get(kit.id);
      if (existing) existing.assets.push(asset);
      else groups.set(kit.id, { kit, assets: [asset] });
    }
    return { kitGroups: [...groups.values()], looseAssets: loose };
  }, [assets, kitMetaById]);

  return (
    <>
      <Tr key="already-reconciled-header" skipEntrance>
        <td
          colSpan={2}
          className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"
        >
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-2"
            aria-expanded={open}
          >
            <span>{open ? "▾" : "▸"}</span>
            <span>Already checked in ({assets.length})</span>
          </button>
        </td>
      </Tr>
      {open ? (
        <>
          {kitGroups.map(({ kit, assets: kitAssets }) => (
            <ReconciledKitGroup
              key={`reconciled-kit-${kit.id}`}
              kit={kit}
              assets={kitAssets}
            />
          ))}
          {looseAssets.map((asset) => renderAlreadyReconciledAsset(asset))}
        </>
      ) : null}
    </>
  );
}

/**
 * Kit grouping for the "already checked in" section — a foldable kit
 * header row followed by its indented child rows (all green "Checked
 * in"). Mirrors the pending-list's `PendingKitGroup` collapsible
 * chevron pattern (see `./pending-items-list.tsx`);
 * collapsed by default to keep the reconciled section compact.
 */
function ReconciledKitGroup({
  kit,
  assets,
}: {
  kit: { id: string; name: string; mainImage: string | null };
  assets: BookingExpectedAsset[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tr key={`reconciled-kit-header-${kit.id}`} skipEntrance>
        <td className="w-full p-0 md:p-0">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-gray-50 md:px-6"
          >
            <div className="flex min-w-0 items-center gap-2">
              <ChevronDownIcon
                aria-hidden="true"
                className={tw(
                  "size-5 shrink-0 text-gray-500 transition-transform duration-150",
                  open ? "rotate-0" : "-rotate-90"
                )}
              />
              {kit.mainImage ? (
                <ImageWithPreview
                  thumbnailUrl={kit.mainImage}
                  alt={kit.name || "Kit"}
                  className="size-[54px] rounded-[2px]"
                />
              ) : (
                <div className="flex size-[54px] shrink-0 items-center justify-center rounded-[2px] border border-gray-200 bg-gray-50">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Kit
                  </span>
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="word-break whitespace-break-spaces font-medium text-gray-800">
                  {kit.name}
                  <span className="ml-1 text-xs font-normal text-gray-500">
                    ({assets.length} {assets.length === 1 ? "asset" : "assets"})
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <span className={assetTypePillClass}>kit</span>
                  <AvailabilityBadge
                    badgeText="Checked in"
                    tooltipTitle="Already checked in"
                    tooltipContent="All of this kit's assets on the booking have been reconciled."
                    className="border-green-200 bg-green-50 text-green-700"
                  />
                </div>
              </div>
            </div>
          </button>
        </td>
        <td>
          <div className="w-[52px]" />
        </td>
      </Tr>
      {open
        ? assets.map((asset) => (
            <Tr
              key={`reconciled-kit-child-${asset.bookingAssetId}`}
              skipEntrance
            >
              <td className="w-full p-0 md:p-0">
                <div className="flex items-center justify-between gap-3 border-l-2 border-gray-200 p-4 pl-8 md:px-6 md:pl-10">
                  <div className="flex items-center gap-2">
                    <ImageWithPreview
                      thumbnailUrl={asset.thumbnailImage || asset.mainImage}
                      alt={asset.title || "Asset"}
                      className="size-[40px] rounded-[2px]"
                    />
                    <div className="flex flex-col gap-1">
                      <span className="word-break whitespace-break-spaces text-sm font-medium text-gray-700">
                        {asset.title}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={assetTypePillClass}>asset</span>
                        <AvailabilityBadge
                          badgeText="Checked in"
                          tooltipTitle="Already checked in"
                          tooltipContent={
                            asset.kind === "QUANTITY_TRACKED"
                              ? "All booked units for this quantity-tracked asset have already been reconciled on this booking."
                              : "This asset was already checked in during a previous session."
                          }
                          className="border-green-200 bg-green-50 text-green-700"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </td>
              <td className="pr-4 text-right md:pr-6">
                <ReconciledQtySummary asset={asset} />
              </td>
            </Tr>
          ))
        : null}
    </>
  );
}

/**
 * `logged / booked` summary with a hover tooltip breaking the logged
 * units into Returned / Consumed / Lost / Damaged + Remaining. Mirrors
 * the qty column on the booking-overview asset rows so the reconciled
 * drawer section is no longer "completely unclear" for qty assets.
 * Renders nothing for INDIVIDUAL entries.
 */
function ReconciledQtySummary({
  asset,
}: {
  asset: BookingExpectedAsset;
}): ReactNode {
  if (asset.kind !== "QUANTITY_TRACKED" || asset.booked <= 0) return null;
  const { booked, logged, remaining, breakdown } = asset;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={tw(
              "inline-flex cursor-help items-center gap-1 text-sm tabular-nums",
              remaining === 0 ? "text-emerald-700" : "text-gray-900"
            )}
          >
            <span className="font-medium">{logged}</span>
            <span className="text-gray-400">/ {booked}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-xs">
          <div className="flex flex-col gap-1 text-xs">
            <div className="font-semibold text-gray-900">
              {remaining === 0
                ? "All units checked in"
                : "Partially checked in"}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-600">Booked</span>
              <span className="tabular-nums text-gray-900">{booked}</span>
            </div>
            {breakdown.returned > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-600">Returned</span>
                <span className="tabular-nums text-emerald-700">
                  {breakdown.returned}
                </span>
              </div>
            ) : null}
            {breakdown.consumed > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-600">Consumed</span>
                <span className="tabular-nums text-gray-900">
                  {breakdown.consumed}
                </span>
              </div>
            ) : null}
            {breakdown.lost > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-600">Lost</span>
                <span className="tabular-nums text-rose-700">
                  {breakdown.lost}
                </span>
              </div>
            ) : null}
            {breakdown.damaged > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-600">Damaged</span>
                <span className="tabular-nums text-amber-700">
                  {breakdown.damaged}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-gray-100 pt-1">
              <span className="text-gray-600">Remaining</span>
              <span
                className={tw(
                  "tabular-nums",
                  remaining === 0
                    ? "text-gray-400"
                    : "font-medium text-amber-700"
                )}
              >
                {remaining}
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Render a row for an asset that has already been fully reconciled
 * (INDIVIDUAL with `alreadyCheckedIn: true`, or qty-tracked with
 * `remaining: 0`). No actions, green "Checked in" badge.
 */
function renderAlreadyReconciledAsset(asset: BookingExpectedAsset): ReactNode {
  return (
    <Tr key={`reconciled-${asset.bookingAssetId}`} skipEntrance>
      <td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-2">
            <ImageWithPreview
              thumbnailUrl={asset.thumbnailImage || asset.mainImage}
              alt={asset.title || "Asset"}
              className="size-[54px] rounded-[2px]"
            />
            <div className="flex flex-col gap-1">
              <span className="word-break whitespace-break-spaces font-medium text-gray-800">
                {asset.title}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypePillClass}>asset</span>
                <AvailabilityBadge
                  badgeText="Checked in"
                  tooltipTitle="Already checked in"
                  tooltipContent={
                    asset.kind === "QUANTITY_TRACKED"
                      ? "All booked units for this quantity-tracked asset have already been reconciled on this booking."
                      : "This asset was already checked in during a previous session."
                  }
                  className="border-green-200 bg-green-50 text-green-700"
                />
              </div>
            </div>
          </div>
        </div>
      </td>
      <td className="pr-4 text-right md:pr-6">
        <ReconciledQtySummary asset={asset} />
      </td>
    </Tr>
  );
}

// Asset row renderer
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const { booking, partialCheckinDetails } = useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);
  const expectedAssets = useAtomValue(bookingExpectedAssetsAtom);

  // The BookingAsset slice this row represents (Polish-7b). A synthetic
  // quick-checkin entry carries `bookingAssetId` on its data; a real scan
  // resolves to the asset's first still-pending qty slice (single-slice
  // assets resolve to their one slice — unchanged behaviour).
  const bookingAssetId =
    (asset as unknown as { bookingAssetId?: string }).bookingAssetId ??
    expectedAssets.find(
      (a) =>
        a.kind === "QUANTITY_TRACKED" && a.id === asset.id && a.remaining > 0
    )?.bookingAssetId ??
    null;

  // Check if asset is in this booking
  const isInBooking = booking.bookingAssets.some(
    (ba) => ba.assetId === asset.id
  );

  // Check if asset is already checked in within this booking using centralized helper
  const isAlreadyCheckedIn = isAssetPartiallyCheckedIn(
    asset,
    partialCheckinDetails,
    booking.status
  );

  // `assetKits` itself tolerates fixtures without the pivot relation.
  const assetKitId = asset.assetKits?.[0]?.kitId;

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
      const kitBookingAssets = booking.bookingAssets.filter(
        (ba) => ba.asset?.assetKits[0]?.kitId === assetKitId
      );
      return (
        kitBookingAssets.length === 1 &&
        kitBookingAssets[0].assetId === asset.id
      );
    })();

  // An active synthetic entry (via quick-checkin) lives under a key
  // prefixed by `qty-checkin:` + the slice's bookingAssetId. Used below to
  // pick between the "Scanned" and "Checked in without scan" badges.
  const isQuickCheckin = Boolean(
    bookingAssetId && items[`${QUICK_CHECKIN_QR_PREFIX}${bookingAssetId}`]
  );

  // Use custom configurations for partial check-in context
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
    // Custom preset for already checked in assets
    {
      condition: isAlreadyCheckedIn && isInBooking,
      badgeText: "Already checked in",
      tooltipTitle: "Asset already checked in",
      tooltipContent:
        "This asset has already been checked in for this booking and cannot be checked in again.",
      priority: 85, // High priority - blocking issue
    },
    // Custom preset for "not in this booking"
    {
      condition: !isInBooking,
      badgeText: "Not in this booking",
      tooltipTitle: "Asset not part of booking",
      tooltipContent:
        "This asset is not part of the current booking and cannot be checked in.",
      priority: 80,
      // Uses default warning colors (appropriate for blocking issue)
    },
    // Custom preset for kit assets - different message based on whether it's the last one
    {
      condition: !!assetKitId && !isRedundant, // Only show if not redundant
      badgeText: "Part of kit",
      tooltipTitle: "Asset is part of a kit",
      tooltipContent: isLastKitAssetInBooking
        ? "This is the last asset from this kit in the booking. Checking it in will also mark the entire kit as available."
        : "This asset belongs to a kit. Checking in this asset individually will not affect the kit status or other kit assets.",
      priority: 60, // Lower priority than blocking issues
      className: "bg-blue-50 border-blue-200 text-blue-700", // Informational blue
    },
    // Positive indicator that this row is "in progress" — either the
    // operator just scanned the QR or clicked Check-in-without-scan
    // on the pending row. Shown only when no higher-priority warning
    // applies (redundant, already checked in, not in booking). This
    // is the signal that differentiates active from pending at a
    // glance, beyond the presence/absence of a disposition form.
    {
      condition:
        isInBooking && !isRedundant && !isAlreadyCheckedIn && !isQuickCheckin,
      badgeText: "Scanned",
      tooltipTitle: "Scanned",
      tooltipContent: "This asset has been scanned in this check-in session.",
      priority: 50,
      className: "bg-green-50 border-green-200 text-green-700",
    },
    {
      condition:
        isInBooking && !isRedundant && !isAlreadyCheckedIn && isQuickCheckin,
      badgeText: "Checked in without scan",
      tooltipTitle: "Marked in without scanning",
      tooltipContent:
        "This quantity-tracked asset was added via the Check in without scanning button — no QR scan required.",
      priority: 50,
      className: "bg-indigo-50 border-indigo-200 text-indigo-700",
    },
  ];

  // Create the availability labels component
  const [, AssetAvailabilityLabels] =
    createAvailabilityLabels(availabilityConfigs);

  const { qtyRemainingByBookingAssetId, recentlyAddedBookingAssetId } =
    useDispositionContext();
  const qtyInfo = bookingAssetId
    ? qtyRemainingByBookingAssetId[bookingAssetId] ?? null
    : null;
  const showQtyControls =
    !!qtyInfo &&
    !!bookingAssetId &&
    isInBooking &&
    !isAlreadyCheckedIn &&
    qtyInfo.remaining > 0;

  return (
    // Mobile: title column + disposition block stack vertically (the
    // disposition block grows to full width below the title). Desktop
    // (`sm:` ~640px+): side-by-side with the block as a fixed-width
    // right column, matching the original two-column layout.
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {/* Left column: asset title + badges. `min-w-0` so long titles can
          truncate/wrap instead of pushing the disposition block off-screen. */}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="word-break whitespace-break-spaces font-medium">
          {asset.title}
        </p>

        <div className="flex flex-wrap items-center gap-1">
          <span className={assetTypePillClass}>asset</span>
          <AssetAvailabilityLabels />
        </div>
      </div>

      {/* Right column: quantity disposition block (qty-tracked only). */}
      {showQtyControls ? (
        <QuantityDispositionBlock
          bookingAssetId={bookingAssetId!}
          info={qtyInfo!}
          shouldFocusOnMount={recentlyAddedBookingAssetId === bookingAssetId}
        />
      ) : null}
    </div>
  );
}

/**
 * Quantity disposition block shown BELOW the asset title + badge for a
 * QUANTITY_TRACKED asset that still has units to reconcile on the
 * booking. Kept as its own row rather than inline next to the title —
 * users found the inline forms confusing to read.
 *
 * Structure for TWO_WAY (returnable):
 *   line 1: `Returned [input] of N`, ✓ when complete
 *   line 2 (shortfall): Lost [input] · Damaged [input] · N pending
 *
 * Structure for ONE_WAY (consumable):
 *   line 1: `Consumed [input] of N`, ✓ when complete
 *   line 2 (shortfall): Returned [input] · Lost [input] · Damaged [input] · N pending
 *     — the extra Returned field lets the operator put any unused
 *     consumable units back to the pool (real-life case: 20
 *     batteries booked, 5 consumed, 15 returned unused).
 *
 * Renders nothing for INDIVIDUAL assets, assets not in the booking, and
 * assets already fully reconciled — the caller guards on `showQtyControls`.
 *
 * When `shouldFocusOnMount` is true, the primary input auto-focuses and
 * scrolls into view. Used by the quick-checkin flow to draw the
 * operator's attention to the newly-inserted row without hijacking the
 * scanner on every re-render.
 */
function QuantityDispositionBlock({
  bookingAssetId,
  info,
  shouldFocusOnMount = false,
}: {
  bookingAssetId: string;
  info: NonNullable<
    DispositionContextValue["qtyRemainingByBookingAssetId"][string]
  >;
  shouldFocusOnMount?: boolean;
}) {
  const { dispositions, updateField } = useDispositionContext();
  const state = dispositions[bookingAssetId] ?? {
    primary: "",
    returned: "",
    lost: "",
    damaged: "",
  };
  const parsed = parseDispositionState(state);
  const total = parsed.primary + parsed.returned + parsed.lost + parsed.damaged;
  const pending = Math.max(0, info.remaining - total);
  const isOverLimit = total > info.remaining;
  const isFullyReturned = !isOverLimit && parsed.primary === info.remaining;
  const isOneWay = info.consumptionType === "ONE_WAY";
  const shortfallVisible =
    parsed.primary < info.remaining ||
    parsed.returned > 0 ||
    parsed.lost > 0 ||
    parsed.damaged > 0;

  const primaryLabel = isOneWay ? "Consumed" : "Returned";

  const primaryInputRef = useRef<HTMLInputElement | null>(null);

  // On first mount with `shouldFocusOnMount` active (i.e. the user just
  // clicked Check-in-without-scanning on the corresponding pending
  // row), focus the primary input and bring the block into view. We
  // scope to mount so subsequent re-renders don't hijack focus.
  useEffect(() => {
    if (!shouldFocusOnMount) return;
    const node = primaryInputRef.current;
    if (!node) return;
    node.focus();
    node.select();
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    // Effect intentionally runs only on mount for the row that carries
    // the flag — the parent clears the flag ~600ms later so no
    // subsequent row is affected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const numInput = tw(
    "w-14 rounded-md border px-2 py-1 text-right text-sm tabular-nums",
    "focus:outline-none focus:ring-1 focus:ring-primary-500",
    "[appearance:textfield]",
    "[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none",
    "[&::-webkit-outer-spin-button]:appearance-none",
    isOverLimit
      ? "border-error-400 text-error-600"
      : "border-gray-200 text-gray-900"
  );

  return (
    <div
      className={tw(
        // Mobile: span the full row width (the AssetRow stacks the
        // left column above this block). Desktop: fixed 256px side
        // column with `shrink-0` so inputs don't squish when the
        // title wraps.
        "w-full rounded-md border bg-white px-3 py-2 sm:w-64 sm:shrink-0",
        isOverLimit ? "border-error-200 bg-error-50/40" : "border-gray-200"
      )}
    >
      {/* Primary row: Returned/Consumed [input] of N  [✓ on happy path] */}
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-gray-700">
          {primaryLabel}
        </span>
        <div className="flex items-center gap-2">
          <input
            ref={primaryInputRef}
            type="number"
            min={0}
            max={info.remaining}
            step={1}
            value={state.primary}
            onChange={(e) =>
              updateField(bookingAssetId, "primary", e.target.value)
            }
            inputMode="numeric"
            aria-label={`${primaryLabel} quantity`}
            className={numInput}
          />
          <span className="text-xs tabular-nums text-gray-500">
            of {info.remaining}
          </span>
          {isFullyReturned ? (
            <CheckIcon className="size-3.5 text-emerald-500" />
          ) : null}
        </div>
      </label>

      {/* Shortfall row — appears when primary < remaining OR user has
          typed in lost/damaged. Compact horizontal layout, inputs aligned
          on the right to match the primary. */}
      {shortfallVisible ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-xs">
          {/* ONE_WAY-only: units the operator is returning to the pool
              unused. E.g. 20 batteries booked, 5 actually consumed,
              15 still good → put 15 back. TWO_WAY assets already use
              the primary input for returned, so this slot is hidden. */}
          {isOneWay ? (
            <label className="flex items-center gap-2">
              <span className="text-gray-600">Returned</span>
              <input
                type="number"
                min={0}
                max={info.remaining}
                step={1}
                value={state.returned}
                onChange={(e) =>
                  updateField(bookingAssetId, "returned", e.target.value)
                }
                inputMode="numeric"
                aria-label="Returned quantity"
                className={tw(numInput, "w-12")}
              />
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Lost</span>
            <input
              type="number"
              min={0}
              max={info.remaining}
              step={1}
              value={state.lost}
              onChange={(e) =>
                updateField(bookingAssetId, "lost", e.target.value)
              }
              inputMode="numeric"
              aria-label="Lost quantity"
              className={tw(numInput, "w-12")}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Damaged</span>
            <input
              type="number"
              min={0}
              max={info.remaining}
              step={1}
              value={state.damaged}
              onChange={(e) =>
                updateField(bookingAssetId, "damaged", e.target.value)
              }
              inputMode="numeric"
              aria-label="Damaged quantity"
              className={tw(numInput, "w-12")}
            />
          </label>
          <span
            className="ml-auto italic text-gray-500"
            title="Units left for a future check-in session"
          >
            <span className="font-medium not-italic tabular-nums text-gray-700">
              {pending}
            </span>{" "}
            pending
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Editable disposition row for a qty-tracked member of a SCANNED kit
 * (Polish-7b). Scanning a kit covers its members, but qty members still
 * need a consumption-log split (Consumed / Returned / Lost / Damaged) just
 * like a standalone qty asset — they aren't simply "checked in" at full
 * remaining. Rendered indented beneath the kit row in the scanned section,
 * keyed by the slice's `bookingAssetId`.
 *
 * The disposition state is seeded to the slice's full remaining by the
 * activation effect, so submitting as-is reconciles everything; the
 * operator can edit before submit.
 */
function ScannedKitQtyMemberRow({ asset }: { asset: QtyExpectedAsset }) {
  const { qtyRemainingByBookingAssetId, recentlyAddedBookingAssetId } =
    useDispositionContext();
  const info = qtyRemainingByBookingAssetId[asset.bookingAssetId] ?? null;
  // Nothing to reconcile (already fully logged) → no row.
  if (!info || info.remaining <= 0) return null;

  return (
    <Tr key={`scanned-kit-qty-${asset.bookingAssetId}`} skipEntrance>
      <td className="w-full p-0 md:p-0">
        <div className="flex flex-col gap-3 border-l-2 border-gray-200 p-4 pb-6 pl-8 sm:flex-row sm:items-start sm:justify-between md:px-6 md:pb-6 md:pl-10">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="word-break whitespace-break-spaces text-sm font-medium text-gray-700">
              {asset.title}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <span className={assetTypePillClass}>asset</span>
              <AvailabilityBadge
                badgeText="From kit"
                tooltipTitle="Quantity-tracked kit member"
                tooltipContent="This quantity-tracked asset is part of the scanned kit. Enter how its units are being returned / consumed / lost / damaged."
                className="border-indigo-200 bg-indigo-50 text-indigo-700"
              />
            </div>
          </div>
          <QuantityDispositionBlock
            bookingAssetId={asset.bookingAssetId}
            info={info}
            shouldFocusOnMount={
              recentlyAddedBookingAssetId === asset.bookingAssetId
            }
          />
        </div>
      </td>
      <td>
        <div className="w-[52px]" />
      </td>
    </Tr>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
  const { booking, partialCheckinProgress, partialCheckinDetails } =
    useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  // Check how many assets from this kit are in the booking
  const bookingAssetIds = new Set(
    booking.bookingAssets.map((ba) => ba.assetId)
  );
  const kitAssets = kit.assetKits.map((ak) => ak.asset);
  const kitAssetsInBooking = kitAssets.filter((a) => bookingAssetIds.has(a.id));
  const allKitAssetsInBooking = kitAssetsInBooking.length === kitAssets.length;
  const noKitAssetsInBooking = kitAssetsInBooking.length === 0;

  // Calculate remaining assets that are still CHECKED_OUT
  const checkedInAssetIds = new Set(
    partialCheckinProgress?.checkedInAssetIds || []
  );

  // Check if this kit is currently scanned
  const isKitScanned = Object.values(items).some(
    (item) => item?.type === "kit" && (item?.data as KitFromQr)?.id === kit.id
  );

  // Calculate remaining assets (not already checked in)
  const uncheckedKitAssetsInBooking = kitAssetsInBooking.filter(
    (asset) => !checkedInAssetIds.has(asset.id)
  );

  const remainingKitAssetsInBooking = isKitScanned
    ? [] // If kit is scanned, no assets are remaining (the unchecked ones will be checked in)
    : uncheckedKitAssetsInBooking;
  const totalKitAssetsInBooking = kitAssetsInBooking.length;

  // Check if all kit assets in booking are already checked in
  const allKitAssetsInBookingAreCheckedIn =
    kitAssetsInBooking.length > 0 &&
    kitAssetsInBooking.every((asset) =>
      isAssetPartiallyCheckedIn(asset, partialCheckinDetails, booking.status)
    );

  // Use preset configurations to define the availability labels
  // Note: In check-in context, we don't show "checked out" labels as that's expected
  const availabilityConfigs = [
    // Custom preset for "already checked in" kits (highest priority - blocking issue)
    {
      condition: allKitAssetsInBookingAreCheckedIn,
      badgeText: "Already checked in",
      tooltipTitle: "Kit already checked in",
      tooltipContent:
        "All assets from this kit have already been checked in for this booking and cannot be checked in again.",
      priority: 85, // High priority - blocking issue
    },
    kitLabelPresets.inCustody(kit.status === AssetStatus.IN_CUSTODY),
    // Removed checkedOut label - expected in check-in context
    kitLabelPresets.hasAssetsInCustody(
      kitAssets.some((asset) => asset.status === AssetStatus.IN_CUSTODY)
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
      badgeText: `${kitAssetsInBooking.length}/${kitAssets.length} assets in booking`,
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
              assets to be checked in)
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
        <span className={assetTypePillClass}>kit</span>
        <KitAvailabilityLabels />
      </div>
    </div>
  );
}

// Custom form component that handles early check-in dialog
type CustomFormProps = {
  assetIdsForCheckin: string[];
  isEarlyCheckin: boolean;
  booking: Pick<Booking, "id" | "name" | "from" | "to">;
  isLoading?: boolean;
  hasBlockers: boolean;
  /**
   * JSON-encoded per-asset disposition payload for QUANTITY_TRACKED
   * assets. Empty string when the booking has no qty-tracked assets in
   * play, in which case the form submits only the legacy `assetIds`
   * array.
   */
  checkinsJson: string;
};

const CustomForm = ({
  assetIdsForCheckin,
  isEarlyCheckin,
  booking,
  isLoading,
  hasBlockers,
  checkinsJson,
}: CustomFormProps) => {
  /** Use state instead of ref so the component re-renders once the form
   * mounts — this guarantees portalContainer is always the real DOM node
   * when the user opens the early-checkin dialog. */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  return (
    <Form
      ref={setFormElement}
      id="partial-checkin-form"
      className="mb-4 flex max-h-full w-full"
      method="post"
    >
      <div className="flex w-full gap-2 p-3">
        {/* Hidden form fields */}
        {assetIdsForCheckin.map((assetId, index) => (
          <input
            key={`assetIds-${assetId}`}
            type="hidden"
            name={`assetIds[${index}]`}
            value={assetId}
          />
        ))}

        {checkinsJson ? (
          <input type="hidden" name="checkins" value={checkinsJson} />
        ) : null}

        {/* Cancel button */}
        <Button type="button" variant="secondary" to=".." className="ml-auto">
          Cancel
        </Button>

        {/* Submit button - conditional based on early check-in */}
        {isEarlyCheckin ? (
          <CheckinDialog
            booking={{
              id: booking.id,
              name: booking.name,
              to: booking.to,
              from: booking.from,
            }}
            label="Check in assets"
            variant="default"
            disabled={
              isLoading || hasBlockers || assetIdsForCheckin.length === 0
            }
            portalContainer={formElement || undefined}
            formId="partial-checkin-form"
            specificAssetIds={assetIdsForCheckin}
          />
        ) : (
          <Button
            type="submit"
            disabled={
              isLoading || hasBlockers || assetIdsForCheckin.length === 0
            }
            className="w-auto"
          >
            Check in assets
          </Button>
        )}
      </div>
    </Form>
  );
};
