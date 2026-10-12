import type { CSSProperties } from "react";
import { useMemo } from "react";
import { AssetStatus, AssetType, KitStatus } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { PackageIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
  assignAlreadyIncludedAtom,
  clearScannedItemsAtom,
  expectedModelRequestsAtom,
  removeScannedItemAtom,
  scannedAssetQuantitiesAtom,
  scannedItemsAtom,
  scannedItemIdsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import type {
  ModelProgress,
  PendingModelRow,
} from "~/components/booking/model-pending-rows";
import { buildPendingModelRows } from "~/components/booking/model-pending-rows";
import { ModelProgressStrips } from "~/components/booking/model-progress-strips";
import { Badge } from "~/components/shared/badge";
import { isQuantityTracked } from "~/modules/asset/utils";
import { matchScansToModelRequests } from "~/modules/booking-model-request/scan-matching";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { tw } from "~/utils/tw";
import {
  assetLabelPresets,
  createAvailabilityLabels,
  kitLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { GenericItemRow, DefaultLoadingState } from "../generic-item-row";
import { ScannedAssetQuantityInput } from "../scanned-asset-quantity-input";
import {
  buildAddToBookingBlockers,
  resolveScannedUnitsAvailable,
} from "./booking-scan-blockers";

// Export the schema so it can be reused
export const addScannedAssetsToBookingSchema = z
  .object({
    assetIds: z.array(z.string()),
    kitIds: z.array(z.string()).optional().default([]),
    /**
     * JSON-encoded `Record<assetId, quantity>` matching the booking
     * picker's `quantities` wire format. Missing entries default
     * `BookingAsset.quantity` to 1 (the schema default), which keeps
     * behaviour stable for callers that don't send a map.
     */
    quantities: z.string().optional().default("{}"),
    /**
     * JSON-encoded `Array<{ assetId, assetKitId, kitId }>` — one element per
     * `AssetKit` membership scanned (i.e. per asset, per kit it belongs
     * to). The action passes this through to `addScannedAssetsToBooking`
     * as `kitSlices` so each gets its own kit-driven `BookingAsset` row
     * with `assetKitId` set (and `sourceKitId` for durable provenance).
     * Carrying a list (not a 1:1 map) is what lets a single asset belonging
     * to MULTIPLE scanned kits produce MULTIPLE kit-driven rows.
     * Directly-scanned assets stay out of this list (standalone,
     * `assetKitId = null`).
     */
    kitSlices: z.string().optional().default("[]"),
  })
  .refine((data) => data.assetIds.length > 0, {
    message: "At least one asset or kit must be selected",
    path: ["assetIds"],
  });

/**
 * Drawer component for managing scanned assets to be added to bookings
 */
export default function AddAssetsToBookingDrawer({
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
  const { booking } = useLoaderData<typeof loader>();

  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // Get asset IDs efficiently using the atom
  const { assetIds } = useAtomValue(scannedItemIdsAtom);

  // Filter and prepare data for component rendering
  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // Separate asset IDs and kit IDs for the form
  // Extract asset IDs from kits and flatten with directly scanned assets
  const assetIdsFromKits = kits.flatMap((kit) =>
    kit.assetKits.map((ak) => ak.asset.id)
  );
  const assetIdsForBooking = Array.from(
    new Set([...assetIds, ...assetIdsFromKits])
  );
  const kitIdsForBooking = kits.map((k) => k.id);

  // Build the kit-driven slice specs for the server. When a scanned KIT
  // contributes assets, each contributes one slice carrying that kit's
  // matching `AssetKit.id`; directly-scanned assets stay out of the list
  // (server defaults `assetKitId` to NULL → standalone).
  //
  // If the same asset shows up via both paths (scan the asset AND scan a
  // kit containing it), the directly-scanned entry wins — standalone
  // takes precedence so the user's explicit asset scan isn't silently
  // treated as kit-driven.
  //
  // An asset appearing in MULTIPLE scanned kits produces MULTIPLE slices
  // (distinct `assetKitId` each) — each is a legal row under the
  // `(bookingId, assetKitId)` partial unique, so all are created.
  const directlyScannedAssetIds = new Set(assetIds);
  const kitSlices: Array<{
    assetId: string;
    assetKitId: string;
    kitId: string;
  }> = [];
  for (const kit of kits) {
    for (const ak of kit.assetKits) {
      if (directlyScannedAssetIds.has(ak.asset.id)) continue;
      // `kitId` rides along as durable provenance for
      // `BookingAsset.sourceKitId`. The server re-resolves it from the
      // (org-validated) `AssetKit` row and only falls back to this value, so
      // it is a hint, never a trusted input.
      kitSlices.push({
        assetId: ak.asset.id,
        assetKitId: ak.id,
        kitId: kit.id,
      });
    }
  }
  const kitSlicesJson = JSON.stringify(kitSlices);

  // Per-asset qty for QUANTITY_TRACKED scans. Only includes ids that
  // actually appear in the submitted `assetIds` (filters out stale
  // entries from a previous scan session).
  const assetQuantities = useAtomValue(scannedAssetQuantitiesAtom);
  const quantitiesJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(assetQuantities).filter(([assetId]) =>
        assetIdsForBooking.includes(assetId)
      )
    )
  );

  // Outstanding model reservations for this booking, seeded by the route's
  // session hook. Empty on a booking that reserves no models, which is what
  // keeps every value derived from it below empty too.
  const expectedModelRequests = useAtomValue(expectedModelRequestsAtom);

  /**
   * Assets already on the booking before this scan session, as the route
   * seeded them. Read from `assignAlreadyIncludedAtom` rather than the Check
   * Out drawer's session atom: the two screens own separate lifecycles, so
   * tearing one down can never clear the other's data.
   */
  const alreadyIncluded = useAtomValue(assignAlreadyIncludedAtom);

  const alreadyIncludedIds = useMemo(
    () => new Set(alreadyIncluded.map((row) => row.id)),
    [alreadyIncluded]
  );

  /**
   * Which of those a scan could still make answer a reservation. An asset can
   * appear twice, once standalone and once through a kit, so one entry saying
   * yes is enough.
   */
  const claimableIncludedIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of alreadyIncluded) {
      if (row.claimable) set.add(row.id);
    }
    return set;
  }, [alreadyIncluded]);

  /**
   * Which scans answer which reservation. The same matcher Check Out uses, so
   * the two screens can never disagree about what a scan is worth.
   *
   * `checksOutScannedOnly` is false here because this screen never checks
   * anything out: an asset already on the booking is a duplicate unless its
   * row can still claim a unit.
   */
  const scannedBuckets = useMemo(
    () =>
      matchScansToModelRequests({
        items,
        expectedModelRequests,
        alreadyIncludedIds,
        claimableIncludedIds,
        checksOutScannedOnly: false,
      }),
    [items, expectedModelRequests, alreadyIncludedIds, claimableIncludedIds]
  );

  /**
   * Scans that will actually answer a reservation, as opposed to assets whose
   * row merely could in principle.
   *
   * `claimableIncludedIds` is structural: it says a row is standalone,
   * unstamped and INDIVIDUAL, not that anything outstanding matches it. Only
   * the matcher knows that, because it also needs a reserved model with
   * capacity left after this session's other scans. Exempting the structural
   * set from the duplicate blocker would wave through every ordinary rescan
   * on a booking with no reservations, which is most of them.
   *
   * Reading the matcher's tally is a prediction of what the server will do,
   * not a guarantee of it: scans are held newest-first, so this client
   * allocates a scarce unit to the most recent matching scan, while the
   * server claims rows in its own query order. The two can therefore
   * disagree on which of several equally-claimable rows wins a single unit.
   * That is fine here because the direction only ever fails closed: the
   * worst case is the blocker holding a scan the server would have accepted,
   * never a duplicate slipping through.
   *
   * The value is the model the row answers, which the badge names.
   */
  const claimedModelNameByAssetId = useMemo(
    () =>
      new Map(
        scannedBuckets.rows
          .filter((row) => row.bucket === "claimed")
          .map((row) => [row.asset!.id, row.claimedModelName] as const)
      ),
    [scannedBuckets.rows]
  );

  /** Per-model progress. `prefulfilled` covers units assigned before this scan. */
  const progressByModel = useMemo<ModelProgress[]>(
    () =>
      expectedModelRequests.map((expected) => ({
        assetModelId: expected.assetModelId,
        assetModelName: expected.assetModelName,
        booked: expected.booked,
        remaining: expected.remaining,
        prefulfilled: Math.max(0, expected.booked - expected.remaining),
        matched:
          scannedBuckets.matchedCountByModel.get(expected.assetModelId) ?? 0,
      })),
    [expectedModelRequests, scannedBuckets.matchedCountByModel]
  );

  /** One synthetic row per unit still to pull, grouped by model. */
  const pendingModelRows = useMemo(
    () => buildPendingModelRows(progressByModel),
    [progressByModel]
  );

  const { blockerConfigs } = buildAddToBookingBlockers({
    items,
    booking,
    claimedAssetIds: new Set(claimedModelNameByAssetId.keys()),
    removeAssetsFromList,
    removeItemsFromList,
  });

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
  });

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
          const scannedAsset = data as AssetFromQr;
          return (
            <AssetRow
              asset={scannedAsset}
              isClaimed={claimedModelNameByAssetId.has(scannedAsset.id)}
              claimedModelName={claimedModelNameByAssetId.get(scannedAsset.id)}
            />
          );
        } else if (item?.type === "kit") {
          return <KitRow kit={data as KitFromQr} />;
        }
        return null;
      }}
      // Booking context so the API attaches `pickerMeta` with the
      // strict-available pool (custody + overlapping-booking aware,
      // matching the booking manage-assets picker).
      searchParams={{
        pickerContext: JSON.stringify({ type: "booking", id: booking.id }),
      }}
    />
  );

  return (
    <ConfigurableDrawer
      schema={addScannedAssetsToBookingSchema}
      formData={{
        // `assetIds` carries the full union (directly-scanned + kit
        // members); the server splits it into the standalone bucket vs
        // the `kitSlices` bucket so an asset in two kits still produces
        // two kit-driven rows.
        assetIds: assetIdsForBooking,
        kitIds: kitIdsForBooking,
        quantities: quantitiesJson,
        kitSlices: kitSlicesJson,
      }}
      items={items}
      onClearItems={clearList}
      title="Items scanned"
      isLoading={isLoading}
      renderItem={renderItemRow}
      Blockers={Blockers}
      disableSubmit={hasBlockers}
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      formName="AddScannedAssetsToBooking"
      headerContent={
        <AssignReservationHeader
          progressByModel={progressByModel}
          pendingModelRows={pendingModelRows}
        />
      }
    />
  );
}

/**
 * Header content rendered above the scanned list: per-model progress strips,
 * then one row per unit still to pull for those models.
 *
 * Lives in `ConfigurableDrawer`'s `headerContent` slot rather than in the
 * item list itself. `ConfigurableDrawer` owns that list, the blockers
 * placement and the empty state; reusing its shared strips and pending-row
 * builder here keeps this screen's numbers identical to Check Out's without
 * taking over rendering this feature doesn't need to change.
 *
 * Renders nothing when the booking reserves no models, so a plain booking
 * looks exactly as this screen always has.
 */
function AssignReservationHeader({
  progressByModel,
  pendingModelRows,
}: {
  progressByModel: ModelProgress[];
  pendingModelRows: PendingModelRow[];
}) {
  if (progressByModel.length === 0) {
    return null;
  }

  return (
    <div className="border border-b-0 bg-gray-50 p-4">
      <div className="flex flex-col gap-3">
        <ModelProgressStrips
          progressByModel={progressByModel}
          idPrefix="assign"
        />
        {pendingModelRows.length > 0 ? (
          <ul className="flex max-h-[176px] flex-col gap-2 overflow-y-auto border-t border-gray-200 pr-1 pt-3">
            {pendingModelRows.map((row) => (
              <PendingModelRowItem
                key={row.key}
                assetModelName={row.assetModelName}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One row standing in for a single unit still to pull for a reserved model.
 * Not interactive: the operator resolves it by scanning a matching QR, the
 * same as the placeholder row Check Out shows for the same unit.
 */
function PendingModelRowItem({ assetModelName }: { assetModelName: string }) {
  return (
    <li className="flex items-center gap-2 border-b border-gray-200 pb-2">
      <div
        aria-hidden="true"
        className="flex size-[40px] shrink-0 items-center justify-center rounded-[2px] border border-gray-200 bg-white"
      >
        <PackageIcon className="size-5 text-gray-400" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="word-break whitespace-break-spaces text-sm font-medium text-gray-800">
          {assetModelName}
        </span>
        <Badge
          color={BADGE_COLORS.gray.bg}
          textColor={BADGE_COLORS.gray.text}
          withDot={false}
        >
          Pending
        </Badge>
      </div>
    </li>
  );
}

// Implement item renderers if they're not already defined elsewhere
export function AssetRow({
  asset,
  isClaimed = false,
  claimedModelName,
}: {
  asset: AssetFromQr;
  /** The matcher credited this scan against an outstanding reserved unit. */
  isClaimed?: boolean;
  /** Name of the model that unit belongs to, when known. */
  claimedModelName?: string;
}) {
  const { booking } = useLoaderData<typeof loader>();
  // Whether the booking is in a checked-out state and the asset is checked out.
  // INDIVIDUAL only — a QUANTITY_TRACKED row reads CHECKED_OUT while free stock
  // remains, so it is judged on its own pool (`maxAllowed`) below.
  const bookingIsCheckedOut = ["ONGOING", "OVERDUE"].includes(booking.status);
  const isCheckedOut =
    asset.type === AssetType.INDIVIDUAL &&
    asset.status === AssetStatus.CHECKED_OUT;

  const unitsAvailable = resolveScannedUnitsAvailable(asset);
  const qtyTracked = unitsAvailable !== null;
  const alreadyInBooking = booking.bookingAssets.some(
    (ba) => ba.assetId === asset.id
  );
  const totalQty = asset.quantity ?? 0;
  const maxAllowed = unitsAvailable ?? 0;
  const noUnitsAvailable = qtyTracked && !alreadyInBooking && maxAllowed <= 0;

  // Use a combination of standard presets and custom configurations
  const availabilityConfigs = [
    assetLabelPresets.archived(!!asset.archivedAt),
    assetLabelPresets.unavailable(!asset.availableToBook),
    assetLabelPresets.partOfKit(
      asset.assetKits.length > 0,
      isQuantityTracked(asset)
    ),
    // A scan the matcher credited against an outstanding reserved unit. The
    // row is on the booking, same as the badge below reports, but here that
    // is the point rather than the problem: submitting stamps this row as
    // the answer to a reservation. It reads green and names the model, so an
    // operator can tell it apart from a rescan that does nothing.
    {
      condition: isClaimed,
      badgeText: claimedModelName
        ? `Already here, now counts toward ${claimedModelName}`
        : "Already here, now counts",
      tooltipTitle: "Counts toward a reserved unit",
      tooltipContent:
        "This asset was already on the booking without answering a reservation. Submitting assigns it to one.",
      priority: 75,
      className: "bg-green-50 border-green-200 text-green-700",
    },
    // Custom preset for "already in this booking"
    {
      condition:
        !isClaimed &&
        booking.bookingAssets.some((ba) => ba.assetId === asset.id),
      badgeText: "Already added to this booking",
      tooltipTitle: "Asset is part of booking",
      tooltipContent: "This asset is already added to the current booking.",
      priority: 70,
    },
    // Custom preset for "already checked out" - blocking issue
    {
      condition: bookingIsCheckedOut && isCheckedOut,
      badgeText: "Already checked out",
      tooltipTitle: "Asset is checked out",
      tooltipContent:
        "This asset is already checked out and cannot be added to a checked-out booking.",
      priority: 80, // High priority - blocking issue
      // Uses default warning colors (red/orange) appropriate for blocking issue
    },
    // Qty-tracked counterpart of the badge above: the pool itself is out, so
    // there is nothing to stage even though the row is a single asset.
    {
      condition: noUnitsAvailable,
      badgeText: "No units available",
      tooltipTitle: "No units available",
      tooltipContent:
        "Every unit of this asset is already in custody, in a kit or reserved for the booking window.",
      priority: 80,
    },
  ];

  // Create the availability labels component
  const [, AssetAvailabilityLabels] =
    createAvailabilityLabels(availabilityConfigs);

  return (
    <div className="flex w-full items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="word-break whitespace-break-spaces font-medium">
          {asset.title}
          {qtyTracked ? (
            <span className="ml-2 text-xs font-normal text-gray-500">
              · {totalQty} {asset.unitOfMeasure || "units"}
              {maxAllowed < totalQty ? (
                <span className="ml-1 text-warning-700">
                  · {maxAllowed} available
                </span>
              ) : null}
            </span>
          ) : null}
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

      {qtyTracked && !alreadyInBooking && maxAllowed > 0 ? (
        <ScannedAssetQuantityInput
          assetId={asset.id}
          max={maxAllowed}
          unit={asset.unitOfMeasure || "units"}
        />
      ) : null}
    </div>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
  const { booking } = useLoaderData<typeof loader>();

  // Check if booking is in checked-out state and kit is checked out
  const bookingIsCheckedOut = ["ONGOING", "OVERDUE"].includes(booking.status);
  const isCheckedOut = kit.status === KitStatus.CHECKED_OUT;

  // Use preset configurations to define the availability labels
  const availabilityConfigs = [
    kitLabelPresets.inCustody(kit.status === KitStatus.IN_CUSTODY),
    kitLabelPresets.hasAssetsInCustody(
      kit.assetKits.some((ak) => ak.asset.status === AssetStatus.IN_CUSTODY)
    ),
    kitLabelPresets.containsUnavailableAssets(
      kit.assetKits.some((ak) => !ak.asset.availableToBook)
    ),
    // Custom preset for "already checked out" - only show when booking is checked out
    {
      condition: bookingIsCheckedOut && isCheckedOut,
      badgeText: "Already checked out",
      tooltipTitle: "Kit is checked out",
      tooltipContent:
        "This kit is already checked out and cannot be added to a checked-out booking.",
      priority: 80, // High priority - blocking issue
      // Uses default warning colors (red/orange) appropriate for blocking issue
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
          ({kit._count.assetKits} assets)
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
