import type { CSSProperties } from "react";
import { AssetStatus, AssetType, KitStatus } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedAssetQuantitiesAtom,
  scannedItemsAtom,
  scannedItemIdsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
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
     * JSON-encoded `Record<assetId, assetKitId>` recording which
     * scanned assets came from scanning a kit's QR. The action passes
     * this through to `addScannedAssetsToBooking` so the created
     * `BookingAsset` rows get `assetKitId` set, which lets the booking
     * UI group those rows under the kit. Directly-scanned assets stay
     * unmapped (standalone, `assetKitId = null`).
     */
    assetKitIdByAsset: z.string().optional().default("{}"),
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
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

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

  // Build per-asset kit-source map for the server. When a scanned KIT
  // contributes assets, those assets get the kit's matching
  // `AssetKit.id` recorded; directly-scanned assets stay unmapped
  // (server defaults `assetKitId` to NULL → standalone).
  //
  // If the same asset shows up via both paths (scan the asset AND
  // scan a kit containing it), the directly-scanned entry wins —
  // standalone takes precedence so the user's explicit asset scan
  // isn't silently treated as kit-driven.
  const directlyScannedAssetIds = new Set(assetIds);
  const assetKitIdByAsset: Record<string, string> = {};
  for (const kit of kits) {
    for (const ak of kit.assetKits) {
      if (directlyScannedAssetIds.has(ak.asset.id)) continue;
      // First kit wins if the same asset appears in multiple scanned
      // kits — partial unique on `(bookingId, assetKitId)` enforces
      // one row per AssetKit anyway; multi-kit assets via scanner
      // would need a separate UX (out of scope here).
      if (!assetKitIdByAsset[ak.asset.id]) {
        assetKitIdByAsset[ak.asset.id] = ak.id;
      }
    }
  }
  const assetKitIdByAssetJson = JSON.stringify(assetKitIdByAsset);

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

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers
  const assetsAlreadyAddedIds = assets
    .filter((asset) => !!asset)
    .filter((asset) =>
      booking.bookingAssets.some((ba) => ba.assetId === asset.id)
    )
    .map((a) => !!a && a.id);

  // Only INDIVIDUAL assets that are in a kit are truly "scan the kit
  // QR instead" cases — the whole asset is committed to a kit, so
  // booking the asset directly would conflict with the kit.
  //
  // QUANTITY_TRACKED assets only have a *slice* of their pool in any
  // given kit (`AssetKit.quantity` ≤ `Asset.quantity`); the free
  // remainder is bookable individually. Server-side availability
  // re-validation (sum-within-pool + DEFERRED trigger) is the source
  // of truth — this client-side blocker is just UX. So qty-tracked
  // rows with kit memberships are no longer blocked here.
  const assetsPartOfKitIds = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.assetKits.length > 0 &&
        asset.id
    )
    .map((asset) => asset.id);

  const unavailableAssetsIds = assets
    .filter((asset) => !asset.availableToBook)
    .map((a) => !!a && a.id);

  // Kit blockers
  const kitsWithUnavailableAssets = kits
    .filter((kit) => kit.assetKits.some((ak) => !ak.asset.availableToBook))
    .map((kit) => kit.id);

  const qrIdsOfUnavailableKits = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return kitsWithUnavailableAssets.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  // Assets already checked out as current booking is checked out
  const checkedOutAssetsIds = assets
    .filter((asset) => asset.status === AssetStatus.CHECKED_OUT)
    .map((asset) => asset.id);
  const tryingToAddCheckedOutAssets =
    checkedOutAssetsIds.length > 0 &&
    ["ONGOING", "OVERDUE"].includes(booking.status);

  // Kits already checked out as current booking is checked out
  const checkedOutKitsIds = kits
    .filter((kit) => kit.status === AssetStatus.CHECKED_OUT)
    .map((kit) => kit.id);
  const qrIdsOfCheckedOutKits = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return checkedOutKitsIds.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);
  const tryingToAddCheckedOutKits =
    checkedOutKitsIds.length > 0 &&
    ["ONGOING", "OVERDUE"].includes(booking.status);

  // Create blockers configuration
  const blockerConfigs = [
    {
      condition: tryingToAddCheckedOutAssets,
      count: checkedOutAssetsIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already checked out.
        </>
      ),
      onResolve: () => removeAssetsFromList(checkedOutAssetsIds),
    },
    {
      condition: tryingToAddCheckedOutKits,
      count: checkedOutKitsIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already checked out.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfCheckedOutKits),
    },
    {
      condition: unavailableAssetsIds.length > 0,
      count: unavailableAssetsIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          marked as <strong>unavailable</strong>.
        </>
      ),
      onResolve: () => removeAssetsFromList(unavailableAssetsIds),
    },
    {
      condition: assetsAlreadyAddedIds.length > 0,
      count: assetsAlreadyAddedIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""}`}</strong> already
          added to the booking.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyAddedIds),
    },
    {
      condition: assetsPartOfKitIds.length > 0,
      count: assetsPartOfKitIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""} `}</strong> are part
          of a kit.
        </>
      ),
      description: "Note: Scan Kit QR to add the full kit",
      onResolve: () => removeAssetsFromList(assetsPartOfKitIds),
    },
    {
      condition: kitsWithUnavailableAssets.length > 0,
      count: kitsWithUnavailableAssets.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s have" : " has"} `}</strong>{" "}
          unavailable assets inside {count > 1 ? "them" : "it"}.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfUnavailableKits),
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
      removeAssetsFromList([
        ...assetsAlreadyAddedIds,
        ...assetsPartOfKitIds,
        ...unavailableAssetsIds,
        ...checkedOutAssetsIds,
      ]);
      removeItemsFromList([
        ...errors.map(([qrId]) => qrId),
        ...qrIdsOfUnavailableKits,
        ...qrIdsOfCheckedOutKits,
      ]);
    },
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
          return <AssetRow asset={data as AssetFromQr} />;
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
        assetIds: assetIdsForBooking,
        kitIds: kitIdsForBooking,
        quantities: quantitiesJson,
        assetKitIdByAsset: assetKitIdByAssetJson,
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
    />
  );
}

// Implement item renderers if they're not already defined elsewhere
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const { booking } = useLoaderData<typeof loader>();
  // Check if booking is in checked-out state and asset is checked out
  const bookingIsCheckedOut = ["ONGOING", "OVERDUE"].includes(booking.status);
  const isCheckedOut = asset.status === AssetStatus.CHECKED_OUT;

  // Use a combination of standard presets and custom configurations
  const availabilityConfigs = [
    assetLabelPresets.unavailable(!asset.availableToBook),
    assetLabelPresets.partOfKit(
      asset.assetKits.length > 0,
      isQuantityTracked(asset)
    ),
    // Custom preset for "already in this booking"
    {
      condition: booking.bookingAssets.some((ba) => ba.assetId === asset.id),
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
  ];

  // Create the availability labels component
  const [, AssetAvailabilityLabels] =
    createAvailabilityLabels(availabilityConfigs);

  const qtyTracked = isQuantityTracked(asset) && asset.quantity != null;
  const alreadyInBooking = booking.bookingAssets.some(
    (ba) => ba.assetId === asset.id
  );
  // `pickerMeta` is the booking picker's available pool — same
  // formula as `bookings/$bookingId/overview/manage-assets`.
  const pickerMeta = qtyTracked ? asset.pickerMeta ?? null : null;
  const totalQty = qtyTracked ? (asset.quantity as number) : 0;
  const maxAllowed = pickerMeta?.maxAllowed ?? totalQty;

  return (
    <div className="flex w-full items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="word-break whitespace-break-spaces font-medium">
          {asset.title}
          {qtyTracked ? (
            <span className="ml-2 text-xs font-normal text-gray-500">
              · {totalQty} {asset.unitOfMeasure || "units"}
              {pickerMeta && pickerMeta.maxAllowed < totalQty ? (
                <span className="ml-1 text-warning-700">
                  · {pickerMeta.maxAllowed} available
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
