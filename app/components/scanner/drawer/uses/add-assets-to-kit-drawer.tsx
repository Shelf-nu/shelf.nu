// components/scanner/drawer.tsx
import { AssetStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import type { LoaderData } from "~/routes/_layout+/kits.$kitId.scan-assets";
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
export const addScannedAssetsToBookingSchema = z.object({
  assetIds: z.array(z.string()).min(1),
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
  const { kit } = useLoaderData<LoaderData>();

  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // Filter and prepare data
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  // List of asset IDs for the form
  const assetIdsForKit = Array.from(new Set([...assets.map((a) => a.id)]));

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers
  const assetsAlreadyAddedIds = assets
    .filter((asset) => !!asset)
    .filter((asset) => kit.assets.some((a) => a?.id === asset.id))
    .map((a) => !!a && a.id);

  // Asset is in custody
  const assetsInCustodyIds = assets
    .filter((asset) => !!asset && asset.status === AssetStatus.IN_CUSTODY)
    .map((asset) => asset.id);

  // Asset is checked out
  const assetsCheckedOutIds = assets
    .filter((asset) => !!asset && asset.status === AssetStatus.CHECKED_OUT)
    .map((asset) => asset.id);

  // Asset is already part of another kit
  const assetsPartOfAnotherKitIds = assets
    .filter((asset) => !!asset && asset.kitId && asset.kitId !== kit.id)
    .map((asset) => asset.id);

  // Get QR IDs for kits to block them from being added to other kits
  const kitQrIds = Object.entries(items)
    .filter(([, item]) => !!item && item.type === "kit")
    .map(([qrId]) => qrId);

  // Create blockers configuration
  const blockerConfigs = [
    {
      condition: assetsAlreadyAddedIds.length > 0,
      count: assetsAlreadyAddedIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already added to this kit.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyAddedIds),
    },
    {
      condition: assetsInCustodyIds.length > 0,
      count: assetsInCustodyIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> in
          custody.
        </>
      ),
      description:
        "Assets in custody cannot be added to kits. Please release custody first.",
      onResolve: () => removeAssetsFromList(assetsInCustodyIds),
    },
    {
      condition: assetsCheckedOutIds.length > 0,
      count: assetsCheckedOutIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          checked out.
        </>
      ),
      description:
        "Checked out assets cannot be added to kits. Please check them in first.",
      onResolve: () => removeAssetsFromList(assetsCheckedOutIds),
    },
    {
      condition: kitQrIds.length > 0,
      count: kitQrIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s" : ""}`}</strong> detected.
          Kits cannot be added to other kits.
        </>
      ),
      description: "Note: Only individual assets can be added to kits.",
      onResolve: () => removeItemsFromList(kitQrIds),
    },
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
          {count > 1 ? "are" : "is"} invalid.
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
        ...assetsInCustodyIds,
        ...assetsCheckedOutIds,
      ]);
      removeItemsFromList([...errors.map(([qrId]) => qrId), ...kitQrIds]);
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
          return <AssetRow asset={data as AssetFromQr} kit={kit} />;
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
      formData={{ assetIds: assetIdsForKit }}
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

// Implement item renderers
export function AssetRow({ asset, kit }: { asset: AssetFromQr; kit: any }) {
  // Use a combination of standard presets and custom configurations
  const availabilityConfigs = [
    assetLabelPresets.inCustody(asset.status === AssetStatus.IN_CUSTODY),
    assetLabelPresets.checkedOut(asset.status === AssetStatus.CHECKED_OUT),
    // Custom preset for "already in this kit"
    {
      condition: kit.assets.some((a: any) => a?.id === asset.id),
      badgeText: "Already added to this kit",
      tooltipTitle: "Asset is part of kit",
      tooltipContent: "This asset is already added to the current kit.",
      priority: 70,
    },
    {
      condition: !!asset.kitId && asset.kitId !== kit.id,
      badgeText: "Part of another kit",
      tooltipTitle: "Asset is part of another kit",
      tooltipContent:
        "You will still be able to add this asset to replace it's current kit.",
      priority: 70,
    },
  ];

  // Create the availability labels component
  const [, AssetAvailabilityLabels] = createAvailabilityLabels(
    availabilityConfigs,
    { maxLabels: 5 }
  );

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
  // Use preset configurations to define the availability labels
  const availabilityConfigs = [
    {
      condition: true, // Always show this label for kits
      badgeText: "Cannot add to kit",
      tooltipTitle: "Kits cannot be added to other kits",
      tooltipContent: "Only individual assets can be added to kits.",
      priority: 100,
    },
    kitLabelPresets.inCustody(kit.status === AssetStatus.IN_CUSTODY),
    kitLabelPresets.checkedOut(kit.status === AssetStatus.CHECKED_OUT),
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
