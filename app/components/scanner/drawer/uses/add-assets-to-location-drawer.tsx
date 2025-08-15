import type { Prisma } from "@prisma/client";
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
import { Button } from "~/components/shared/button";
import type { LoaderData } from "~/routes/_layout+/locations.$locationId.scan-assets";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { tw } from "~/utils/tw";
import { createAvailabilityLabels } from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { GenericItemRow, DefaultLoadingState } from "../generic-item-row";

// Export the schema so it can be reused
export const addScannedAssetsToLocationSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

/** Extend the type so we can use it. This is based on the extra asset includes passed to the row */
type AssetFromQrWithLocation = AssetFromQr & {
  location: {
    id: string;
    name: string;
  };
};

/**
 * Drawer component for managing scanned assets to be added to bookings
 */
export default function AddAssetsToLocationDrawer({
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
  const { location } = useLoaderData<LoaderData>();
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
  const assetIdsForLocation = Array.from(new Set([...assets.map((a) => a.id)]));

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers
  const assetsAlreadyAddedIds = assets
    .filter((asset) => !!asset)
    .filter((asset) => location.assets.some((a) => a?.id === asset.id))
    .map((a) => !!a && a.id);

  // Get QR IDs for kits to block them from being added to location
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
          already added to this location.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyAddedIds),
    },
    {
      condition: kitQrIds.length > 0,
      count: kitQrIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s" : ""}`}</strong> detected.
          Kits cannot be added to locations.
        </>
      ),
      description: "Note: Only individual assets can be added to locations.",
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
      removeAssetsFromList([...assetsAlreadyAddedIds]);
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
          return (
            <AssetRow
              asset={data as AssetFromQrWithLocation}
              location={location}
            />
          );
        } else if (item?.type === "kit") {
          return <KitRow kit={data as KitFromQr} />;
        }
        return null;
      }}
      assetExtraInclude={{
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      }}
    />
  );

  return (
    <ConfigurableDrawer
      schema={addScannedAssetsToLocationSchema}
      /**
       * We merge the existing assetIds(kitAssetsIds) with the ids of the scanned assets(assetIdsForKit).
       * We have to do this because the manageAssets action expects both of them to be present in the formData sent */
      formData={{ assetIds: assetIdsForLocation }}
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
      formName="AddScannedAssetsToLocation"
    />
  );
}

// Implement item renderers
export function AssetRow({
  asset,
  location,
}: {
  asset: AssetFromQrWithLocation;
  location: Pick<
    Prisma.LocationGetPayload<{
      include: {
        assets: {
          select: {
            id: true;
          };
        };
      };
    }>,
    "id" | "assets"
  >;
}) {
  // Use a combination of standard presets and custom configurations
  const availabilityConfigs = [
    // Custom preset for "already in this kit"
    {
      condition: location.assets.some((a: any) => a?.id === asset.id),
      badgeText: "Already added to this location",
      tooltipTitle: "Asset is part of location",
      tooltipContent: "This asset is already added to the current location.",
      priority: 70,
    },
    {
      condition: !!asset.locationId && asset.locationId !== location.id,
      badgeText: "Part of another location",
      tooltipTitle: "Asset is part of another location",
      tooltipContent: (
        <>
          This asset is currently part of another kit
          {asset?.location ? (
            <>
              :{" "}
              <Button
                to={`/locations/${asset.location.id}`}
                target="_blank"
                variant="link-gray"
                className={"text-xs"}
              >
                {asset.location.name}
              </Button>
              <br />
            </>
          ) : undefined}
          You will still be able to add this asset to replace it's current
          location.
        </>
      ),
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
      </div>
    </div>
  );
}
