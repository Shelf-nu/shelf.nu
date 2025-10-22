import { AssetStatus, KitStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  scannedItemIdsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
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

// Export the schema so it can be reused
export const addScannedAssetsToBookingSchema = z
  .object({
    assetIds: z.array(z.string()),
    kitIds: z.array(z.string()).optional().default([]),
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
  style?: React.CSSProperties;
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
    kit.assets.map((asset) => asset.id)
  );
  const assetIdsForBooking = Array.from(
    new Set([...assetIds, ...assetIdsFromKits])
  );
  const kitIdsForBooking = kits.map((k) => k.id);

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers
  const assetsAlreadyAddedIds = assets
    .filter((asset) => !!asset)
    .filter((asset) => booking.assets.some((a) => a?.id === asset.id))
    .map((a) => !!a && a.id);

  const assetsPartOfKitIds = assets
    .filter((asset) => !!asset && asset.kitId && asset.id)
    .map((asset) => asset.id);

  const unavailableAssetsIds = assets
    .filter((asset) => !asset.availableToBook)
    .map((a) => !!a && a.id);

  // Kit blockers
  const kitsWithUnavailableAssets = kits
    .filter((kit) => kit.assets.some((a) => !a.availableToBook))
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
    />
  );

  return (
    <ConfigurableDrawer
      schema={addScannedAssetsToBookingSchema}
      formData={{
        assetIds: assetIdsForBooking,
        kitIds: kitIdsForBooking,
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
    assetLabelPresets.partOfKit(!!asset.kitId),
    // Custom preset for "already in this booking"
    {
      condition: booking.assets.some((a) => a?.id === asset.id),
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

  return (
    <div className="flex flex-col gap-1">
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
      kit.assets.some((asset) => asset.status === AssetStatus.IN_CUSTODY)
    ),
    kitLabelPresets.containsUnavailableAssets(
      kit.assets.some((asset) => !asset.availableToBook)
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
          ({kit._count.assets} assets)
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
