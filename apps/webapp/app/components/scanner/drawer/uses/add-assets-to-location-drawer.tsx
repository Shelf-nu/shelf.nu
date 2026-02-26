import type { CSSProperties } from "react";
import type { Prisma } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useLoaderData } from "react-router";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  scannedItemIdsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { Button } from "~/components/shared/button";
import type { LoaderData } from "~/routes/_layout+/locations.$locationId.scan-assets-kits";
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
export const addScannedAssetsOrKitsToLocationSchema = z.object({
  assetIds: z.array(z.string()).optional().default([]),
  kitIds: z.array(z.string()).optional().default([]),
});

/** Extend the type so we can use it. This is based on the extra asset includes passed to the row */
type AssetFromQrWithLocation = AssetFromQr & {
  location: {
    id: string;
    name: string;
  };
};

/**
 * Drawer component for managing scanned assets/kits to be added to bookings
 */
export default function AddAssetsKitsToLocationDrawer({
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
  const { location } = useLoaderData<LoaderData>();
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
    .filter((item) => !!item && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // List of asset IDs for the form
  const assetIdsForLocation = Array.from(new Set([...assetIds]));
  const kitIdsForLocation = Array.from(new Set([...kits.map((k) => k.id)]));

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers
  const assetsAlreadyAddedIds = assets
    .filter((asset) => !!asset)
    .filter((asset) => location.assets.some((a) => a?.id === asset.id))
    .map((a) => !!a && a.id);

  // Kit blockers
  const kitsAlreadyAddedIds = kits
    .filter((kit) => !!kit)
    .filter((kit) => location.kits.some((k) => k?.id === kit.id))
    .map((k) => !!k && k.id);

  const qrIdsOfAlreadyAddedKits = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return kitsAlreadyAddedIds.includes((item?.data as any)?.id);
    })
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
      condition: kitsAlreadyAddedIds.length > 0,
      count: kitsAlreadyAddedIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already added to this location.
        </>
      ),
      onResolve: () => removeItemsFromList([...qrIdsOfAlreadyAddedKits]),
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
      removeItemsFromList([
        ...errors.map(([qrId]) => qrId),
        ...qrIdsOfAlreadyAddedKits,
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
          return (
            <AssetRow
              asset={data as AssetFromQrWithLocation}
              location={location}
            />
          );
        } else if (item?.type === "kit") {
          return <KitRow kit={data as KitFromQr} location={location} />;
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
      schema={addScannedAssetsOrKitsToLocationSchema}
      /**
       * We merge the existing assetIds(kitAssetsIds) with the ids of the scanned assets(assetIdsForKit).
       * We have to do this because the manageAssets action expects both of them to be present in the formData sent */
      formData={{ assetIds: assetIdsForLocation, kitIds: kitIdsForLocation }}
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
      formName="AddScannedAssetsOrKitsToLocation"
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
            "inline-block bg-color-50 px-[6px] py-[2px]",
            "rounded-md border border-color-200",
            "text-xs text-color-700"
          )}
        >
          asset
        </span>
        <AssetAvailabilityLabels />
      </div>
    </div>
  );
}

export function KitRow({
  kit,
  location,
}: {
  kit: KitFromQr;
  location: Pick<
    Prisma.LocationGetPayload<{
      include: {
        kits: { select: { id: true } };
      };
    }>,
    "id" | "kits"
  >;
}) {
  // Use a combination of standard presets and custom configurations
  const availabilityConfigs = [
    // Custom preset for "already in this kit"
    {
      condition: location.kits.some((a: any) => a?.id === kit.id),
      badgeText: "Already added to this location",
      tooltipTitle: "Kit is part of location",
      tooltipContent: "This kit is already added to the current location.",
      priority: 70,
    },
    {
      condition: !!kit.locationId && kit.locationId !== location.id,
      badgeText: "Part of another location",
      tooltipTitle: "Kit is part of another location",
      tooltipContent: (
        <>
          This kit is currently part of another location
          {kit?.location ? (
            <>
              :{" "}
              <Button
                to={`/locations/${kit.location.id}`}
                target="_blank"
                variant="link-gray"
                className={"text-xs"}
              >
                {kit.location.name}
              </Button>
              <br />
            </>
          ) : undefined}
          You will still be able to add this kit to replace it's current
          location.
        </>
      ),
      priority: 70,
    },
  ];

  // Create the availability labels component
  const [, KitAvailabilityLabels] = createAvailabilityLabels(
    availabilityConfigs,
    { maxLabels: 5 }
  );

  return (
    <div className="flex flex-col gap-1">
      <p className="word-break whitespace-break-spaces font-medium">
        {kit.name}{" "}
        <span className="text-[12px] font-normal text-color-700">
          ({kit._count.assets} assets)
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={tw(
            "inline-block bg-color-50 px-[6px] py-[2px]",
            "rounded-md border border-color-200",
            "text-xs text-color-700"
          )}
        >
          kit
        </span>
        <KitAvailabilityLabels />
      </div>
    </div>
  );
}
