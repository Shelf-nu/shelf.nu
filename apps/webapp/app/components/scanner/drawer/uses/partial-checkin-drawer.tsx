import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { AssetStatus } from "@prisma/client";
import type { Booking } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import CheckinDialog from "~/components/booking/checkin-dialog";
import { Form } from "~/components/custom-form";
import { CheckIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Progress } from "~/components/shared/progress";
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
import { GenericItemRow, DefaultLoadingState } from "../generic-item-row";

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
  lost: string;
  damaged: string;
};

type DispositionMap = Record<string, QtyDispositionState>;

/**
 * Context exposing per-asset disposition state down to the `AssetRow`
 * render function. Using context (not prop drilling) because `AssetRow`
 * is rendered via a callback passed to `ConfigurableDrawer`, making direct
 * prop passing awkward.
 */
type DispositionContextValue = {
  /** Map of assetId → per-asset disposition state. */
  dispositions: DispositionMap;
  /**
   * Per-asset `remaining` + `consumptionType` coming from the loader.
   * Empty when the booking has no qty-tracked assets.
   */
  qtyRemainingByAssetId: Record<
    string,
    {
      booked: number;
      logged: number;
      remaining: number;
      consumptionType: "ONE_WAY" | "TWO_WAY" | null;
    }
  >;
  updateField: (
    assetId: string,
    field: keyof QtyDispositionState,
    value: string
  ) => void;
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
  const lost = Number(state?.lost ?? "");
  const damaged = Number(state?.damaged ?? "");
  return {
    primary: Number.isFinite(primary) ? primary : 0,
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

/**
 * Drawer component for managing scanned assets to be checked in from bookings
 */
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
  } = useLoaderData<typeof loader>();

  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  /**
   * Per-qty-tracked-asset disposition state. Keyed by assetId. Populated
   * on-demand when a qty-tracked asset is scanned (see effect below).
   * Primary defaults to the remaining count so the happy-path is "scan
   * and submit".
   */
  const [dispositions, setDispositions] = useState<DispositionMap>({});

  const updateField = useCallback(
    (assetId: string, field: keyof QtyDispositionState, value: string) => {
      setDispositions((prev) => ({
        ...prev,
        [assetId]: {
          primary: prev[assetId]?.primary ?? "",
          lost: prev[assetId]?.lost ?? "",
          damaged: prev[assetId]?.damaged ?? "",
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

  const assetIdsForCheckin = Array.from(
    new Set([
      ...assets
        .filter(
          (a) => bookingAssetIds.has(a.id) && !checkedInAssetIds.has(a.id)
        )
        .map((a) => a.id),
      ...kits.flatMap((k) =>
        k.assets
          .filter(
            (a) => bookingAssetIds.has(a.id) && !checkedInAssetIds.has(a.id)
          )
          .map((a) => a.id)
      ),
    ])
  );

  /**
   * Asset IDs in `assetIdsForCheckin` that are qty-tracked AND still have
   * units to reconcile on this booking. The drawer surfaces a per-row
   * quantity input for these and serializes them into the `checkins`
   * JSON payload on submit.
   */
  const qtyTrackedIdsForCheckin = useMemo(
    () =>
      assetIdsForCheckin.filter((id) => {
        const info = qtyRemainingByAssetId?.[id];
        return !!info && info.remaining > 0;
      }),
    [assetIdsForCheckin, qtyRemainingByAssetId]
  );

  /**
   * Keep the disposition map in sync with the current scan set:
   *
   * 1. Drop entries for assets no longer in `qtyTrackedIdsForCheckin`
   *    (the user removed the scan via the trash icon). Without this,
   *    re-scanning the same asset would restore its previous edited
   *    values — confusing because the trash action is meant to "clear"
   *    that row.
   *
   * 2. Seed entries for assets that are newly in the queue. Primary
   *    input defaults to the full remaining quantity so the happy-path
   *    is "scan and submit". Existing entries (for assets still in the
   *    queue) are preserved so typing isn't lost as other scans arrive.
   *
   * We return the previous reference when nothing changed, to avoid
   * pointless re-renders.
   */
  useEffect(() => {
    if (!qtyRemainingByAssetId) return;
    setDispositions((prev) => {
      const inPlay = new Set(qtyTrackedIdsForCheckin);
      let changed = false;
      let next: DispositionMap = {};

      // Keep only entries whose asset is still scanned.
      for (const [id, state] of Object.entries(prev)) {
        if (inPlay.has(id)) {
          next[id] = state;
        } else {
          changed = true;
        }
      }

      // Seed newly-scanned assets with their remaining quantity.
      for (const id of qtyTrackedIdsForCheckin) {
        if (next[id]) continue;
        const info = qtyRemainingByAssetId[id];
        if (!info) continue;
        next = {
          ...next,
          [id]: {
            primary: String(info.remaining),
            lost: "",
            damaged: "",
          },
        };
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [qtyTrackedIdsForCheckin, qtyRemainingByAssetId]);

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

  // Note: In partial check-in context, we allow individual kit assets to be checked in
  // so we don't create blockers for assets that are part of kits

  // Kit blockers - kits not in this booking
  const kitsNotInBooking = kits
    .filter((kit) => !kit.assets.some((a) => bookingAssetIds.has(a.id)))
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
      const kitAssetsInBooking = kit.assets.filter((asset) =>
        bookingAssetIds.has(asset.id)
      );

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
    if (!asset.kitId) return;

    // Check if this asset's kit is also scanned
    const kitIsScanned = kits.some((kit) => kit.id === asset.kitId);
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
  const zeroDispositionQtyIds = qtyTrackedIdsForCheckin.filter((id) => {
    const parsed = parseDispositionState(dispositions[id]);
    return parsed.primary + parsed.lost + parsed.damaged === 0;
  });
  const qrIdsOfZeroDispositionQty = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "asset") return false;
      return zeroDispositionQtyIds.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  /**
   * Also flag over-return: if (primary + lost + damaged) exceeds the
   * remaining count, the server will reject the submission. Surface it
   * client-side so the user can fix before hitting submit.
   */
  const overReturnQtyIds = qtyTrackedIdsForCheckin.filter((id) => {
    const info = qtyRemainingByAssetId?.[id];
    if (!info) return false;
    const parsed = parseDispositionState(dispositions[id]);
    return parsed.primary + parsed.lost + parsed.damaged > info.remaining;
  });
  const qrIdsOfOverReturnQty = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "asset") return false;
      return overReturnQtyIds.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

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
        "Enter a returned / consumed / lost / damaged quantity — or remove the scan.",
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
    if (qtyTrackedIdsForCheckin.length === 0) return "";
    const payload: CheckinDisposition[] = qtyTrackedIdsForCheckin.map((id) => {
      const state = dispositions[id];
      const parsed = parseDispositionState(state);
      const info = qtyRemainingByAssetId?.[id];
      const isOneWay = info?.consumptionType === "ONE_WAY";
      return {
        assetId: id,
        ...(isOneWay
          ? { consumed: parsed.primary }
          : { returned: parsed.primary }),
        lost: parsed.lost,
        damaged: parsed.damaged,
      };
    });
    return JSON.stringify(payload);
  }, [qtyTrackedIdsForCheckin, dispositions, qtyRemainingByAssetId]);

  const dispositionCtxValue = useMemo<DispositionContextValue>(
    () => ({
      dispositions,
      qtyRemainingByAssetId: qtyRemainingByAssetId ?? {},
      updateField,
    }),
    [dispositions, qtyRemainingByAssetId, updateField]
  );

  // Create booking header component
  const BookingHeader = () => (
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

  // Render item row
  const renderItemRow = (qrId: string, item: any) => (
    <GenericItemRow
      key={qrId}
      qrId={qrId}
      item={item}
      onRemove={removeItem}
      renderLoading={(qrId, error) => (
        <DefaultLoadingState qrId={qrId} error={error} />
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
        title={
          <div className="text-right">
            <span className="block text-gray-600">
              {assetIdsForCheckin.length}/
              {partialCheckinProgress?.uncheckedCount ||
                booking.bookingAssets.length}{" "}
              Assets scanned
            </span>
            <span className="flex h-5 flex-col justify-center font-medium text-gray-900">
              <Progress
                value={
                  (assetIdsForCheckin.length /
                    (partialCheckinProgress?.uncheckedCount ||
                      booking.bookingAssets.length)) *
                  100
                }
              />
            </span>
          </div>
        }
        isLoading={isLoading}
        renderItem={renderItemRow}
        Blockers={Blockers}
        defaultExpanded={defaultExpanded}
        className={tw(
          "[&_.default-base-drawer-header]:rounded-b [&_.default-base-drawer-header]:border [&_.default-base-drawer-header]:px-4 [&_thead]:hidden",
          className
        )}
        style={style}
        headerContent={<BookingHeader />}
      />
    </DispositionContext.Provider>
  );
}

// Asset row renderer
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const { booking, partialCheckinDetails } = useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

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

  // Check if this asset is redundant (kit is also scanned)
  const isRedundant =
    !!asset.kitId &&
    (() => {
      const kits = Object.values(items)
        .filter((item) => !!item && item.data && item.type === "kit")
        .map((item) => item?.data as any);
      return kits.some((kit) => kit.id === asset.kitId);
    })();

  // Check if this is the last asset of a kit in this booking
  const isLastKitAssetInBooking =
    !!asset.kitId &&
    (() => {
      const kitBookingAssets = booking.bookingAssets.filter(
        (ba) => ba.asset?.kitId === asset.kitId
      );
      return (
        kitBookingAssets.length === 1 &&
        kitBookingAssets[0].assetId === asset.id
      );
    })();

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
      condition: !!asset.kitId && !isRedundant, // Only show if not redundant
      badgeText: "Part of kit",
      tooltipTitle: "Asset is part of a kit",
      tooltipContent: isLastKitAssetInBooking
        ? "This is the last asset from this kit in the booking. Checking it in will also mark the entire kit as available."
        : "This asset belongs to a kit. Checking in this asset individually will not affect the kit status or other kit assets.",
      priority: 60, // Lower priority than blocking issues
      className: "bg-blue-50 border-blue-200 text-blue-700", // Informational blue
    },
  ];

  // Create the availability labels component
  const [, AssetAvailabilityLabels] =
    createAvailabilityLabels(availabilityConfigs);

  const { qtyRemainingByAssetId } = useDispositionContext();
  const qtyInfo = qtyRemainingByAssetId[asset.id] ?? null;
  const showQtyControls =
    !!qtyInfo && isInBooking && !isAlreadyCheckedIn && qtyInfo.remaining > 0;

  return (
    <div className="flex items-start justify-between gap-3">
      {/* Left column: asset title + badges. `min-w-0` so long titles can
          truncate/wrap instead of pushing the disposition block off-screen. */}
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

      {/* Right column: quantity disposition block (qty-tracked only). */}
      {showQtyControls ? (
        <QuantityDispositionBlock assetId={asset.id} info={qtyInfo!} />
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
 * Structure:
 *   line 1: `Returned [input] of N` (or Consumed for ONE_WAY), ✓ when complete
 *   line 2 (only when shortfall): Lost [input] · Damaged [input] · N pending
 *
 * Renders nothing for INDIVIDUAL assets, assets not in the booking, and
 * assets already fully reconciled — the caller guards on `showQtyControls`.
 */
function QuantityDispositionBlock({
  assetId,
  info,
}: {
  assetId: string;
  info: NonNullable<DispositionContextValue["qtyRemainingByAssetId"][string]>;
}) {
  const { dispositions, updateField } = useDispositionContext();
  const state = dispositions[assetId] ?? { primary: "", lost: "", damaged: "" };
  const parsed = parseDispositionState(state);
  const total = parsed.primary + parsed.lost + parsed.damaged;
  const pending = Math.max(0, info.remaining - total);
  const isOverLimit = total > info.remaining;
  const isFullyReturned = !isOverLimit && parsed.primary === info.remaining;
  const shortfallVisible =
    parsed.primary < info.remaining || parsed.lost > 0 || parsed.damaged > 0;

  const primaryLabel =
    info.consumptionType === "ONE_WAY" ? "Consumed" : "Returned";

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
        // Fixed-ish width so the left column (title + badges) gets the flex
        // remainder; shrink-0 prevents the inputs from squishing when the
        // title wraps.
        "w-64 shrink-0 rounded-md border bg-white px-3 py-2",
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
            type="number"
            min={0}
            max={info.remaining}
            step={1}
            value={state.primary}
            onChange={(e) => updateField(assetId, "primary", e.target.value)}
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
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Lost</span>
            <input
              type="number"
              min={0}
              max={info.remaining}
              step={1}
              value={state.lost}
              onChange={(e) => updateField(assetId, "lost", e.target.value)}
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
              onChange={(e) => updateField(assetId, "damaged", e.target.value)}
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

export function KitRow({ kit }: { kit: KitFromQr }) {
  const { booking, partialCheckinProgress, partialCheckinDetails } =
    useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  // Check how many assets from this kit are in the booking
  const bookingAssetIds = new Set(
    booking.bookingAssets.map((ba) => ba.assetId)
  );
  const kitAssetsInBooking = kit.assets.filter((a) =>
    bookingAssetIds.has(a.id)
  );
  const allKitAssetsInBooking = kitAssetsInBooking.length === kit.assets.length;
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
      kit.assets.some((asset) => asset.status === AssetStatus.IN_CUSTODY)
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
      badgeText: `${kitAssetsInBooking.length}/${kit.assets.length} assets in booking`,
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
            key={`assetIds-${index}`}
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
