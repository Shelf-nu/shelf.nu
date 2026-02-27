import { useRef } from "react";
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

// Export the schema so it can be reused
export const partialCheckinAssetsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
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
  const { booking, partialCheckinProgress, partialCheckinDetails } =
    useLoaderData<typeof loader>();

  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // Filter and prepare data for component rendering
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // List of asset IDs for the form - only include assets that are actually in the booking
  const bookingAssetIds = new Set(booking.assets.map((a) => a.id));

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

  // Check if this would be a final check-in (all remaining assets are being checked in)
  const remainingAssetCount =
    partialCheckinProgress?.uncheckedCount || booking.assets.length;
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
      ]);
    },
  });

  // Create booking header component
  const BookingHeader = () => (
    <div className="border border-b-0 bg-color-50 p-4">
      <div className="flex items-center justify-between">
        {/* Left side: Booking name and status */}
        <div className="flex items-center gap-3">
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              <Button
                to={`/bookings/${booking.id}`}
                variant="link"
                className="text-left font-medium text-color-900 hover:text-color-700"
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
            <span className="block text-color-600">From</span>
            <span className="block font-medium text-color-900">
              <DateS date={booking.from} includeTime />
            </span>
          </div>

          {/* To date */}
          <div className="text-right">
            <span className="block text-color-600">To</span>
            <span className="block font-medium text-color-900">
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
        />
      }
      title={
        <div className="text-right">
          <span className="block text-color-600">
            {assetIdsForCheckin.length}/
            {partialCheckinProgress?.uncheckedCount || booking.assets.length}{" "}
            Assets scanned
          </span>
          <span className="flex h-5 flex-col justify-center font-medium text-color-900">
            <Progress
              value={
                (assetIdsForCheckin.length /
                  (partialCheckinProgress?.uncheckedCount ||
                    booking.assets.length)) *
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
  );
}

// Asset row renderer
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const { booking, partialCheckinDetails } = useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  // Check if asset is in this booking
  const isInBooking = booking.assets.some((a) => a.id === asset.id);

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
      const kitAssetsInBooking = booking.assets.filter(
        (a) => a.kitId === asset.kitId
      );
      return (
        kitAssetsInBooking.length === 1 && kitAssetsInBooking[0].id === asset.id
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

export function KitRow({ kit }: { kit: KitFromQr }) {
  const { booking, partialCheckinProgress, partialCheckinDetails } =
    useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  // Check how many assets from this kit are in the booking
  const bookingAssetIds = new Set(booking.assets.map((a) => a.id));
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
        <span className="text-[12px] font-normal text-color-700">
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

// Custom form component that handles early check-in dialog
type CustomFormProps = {
  assetIdsForCheckin: string[];
  isEarlyCheckin: boolean;
  booking: Pick<Booking, "id" | "name" | "from" | "to">;
  isLoading?: boolean;
  hasBlockers: boolean;
};

const CustomForm = ({
  assetIdsForCheckin,
  isEarlyCheckin,
  booking,
  isLoading,
  hasBlockers,
}: CustomFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Form ref={formRef} className="mb-4 flex max-h-full w-full" method="post">
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
            disabled={isLoading || hasBlockers}
            portalContainer={formRef.current || undefined}
            specificAssetIds={assetIdsForCheckin}
          />
        ) : (
          <Button
            type="submit"
            disabled={isLoading || hasBlockers}
            className="w-auto"
          >
            Check in assets
          </Button>
        )}
      </div>
    </Form>
  );
};
