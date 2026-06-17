import { useState } from "react";
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
import CheckoutDialog from "~/components/booking/checkout-dialog";
import { Form } from "~/components/custom-form";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { Progress } from "~/components/shared/progress";
import {
  countRemainingCheckoutAssets,
  isAssetCheckoutEligible,
  isBookingEarlyCheckout,
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

// Export the schema so it can be reused (e.g. by checkoutAssets in service.server)
export const partialCheckoutAssetsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

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
  const { booking, checkedOutAssetIds, checkedInAssetIds } =
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

  // Get assets that have already been checked out (should be excluded from count)
  const alreadyCheckedOut = new Set(checkedOutAssetIds || []);

  // Assets already returned via partial check-in. They are AVAILABLE again but
  // DONE for this booking, so they must NOT be offered for checkout nor counted
  // in the "remaining to check out" denominator. Without this, a returned asset
  // that was checked out via the all-at-once flow (which leaves no
  // partial-checkout record) would be re-counted as still-bookable.
  const alreadyReturned = new Set(checkedInAssetIds || []);

  // Eligible to check out = in this booking AND still checkout-eligible (not
  // already checked out, not returned via check-in, not in custody). The
  // eligibility rule itself lives in the shared `isAssetCheckoutEligible` helper
  // so this filter and the "remaining" denominator below describe the SAME set.
  // The server rejects in-custody/already-out assets, so including them would
  // fail the whole batch; the corresponding blockers still surface them.
  const isCheckoutEligibleAsset = (a: { id: string; status: AssetStatus }) =>
    bookingAssetIds.has(a.id) &&
    isAssetCheckoutEligible(a, alreadyCheckedOut, alreadyReturned);

  const assetIdsForCheckout = Array.from(
    new Set([
      ...assets.filter(isCheckoutEligibleAsset).map((a) => a.id),
      ...kits.flatMap((k) =>
        k.assets.filter(isCheckoutEligibleAsset).map((a) => a.id)
      ),
    ])
  );

  // Assets in this booking still available to check out (asset-scoped, so it
  // matches the asset-counted numerator regardless of the kits-as-unit setting).
  // Uses the same shared eligibility rule as the filter above, so the
  // denominator equals the set a user can actually scan out: excludes recorded
  // checkouts, live CHECKED_OUT, already-returned (check-in), and in-custody.
  const remainingBookedAssets = countRemainingCheckoutAssets(
    booking.assets,
    checkedOutAssetIds || [],
    checkedInAssetIds || []
  );

  // Early checkout applies to ANY scan that activates a not-yet-started booking,
  // not just the final batch — the first partial scan transitions RESERVED →
  // ONGOING, so the user gets the same adjust-the-start-date prompt as the
  // all-at-once checkout. The dialog's choice flows to the server as
  // checkoutIntentChoice.
  const isEarlyCheckout = Boolean(
    assetIdsForCheckout.length > 0 && isBookingEarlyCheckout(booking.from)
  );

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers - only assets NOT in this booking
  const assetsNotInBookingIds = assets
    .filter((asset) => !bookingAssetIds.has(asset.id))
    .map((a) => a.id);

  // Assets that are already checked out for this booking (status CHECKED_OUT or
  // recorded in a prior partial check-out for this booking).
  const alreadyCheckedOutAssets = assets
    .filter(
      (asset) =>
        bookingAssetIds.has(asset.id) &&
        (asset.status === AssetStatus.CHECKED_OUT ||
          alreadyCheckedOut.has(asset.id))
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
    .filter((kit) => !kit.assets.some((a) => bookingAssetIds.has(a.id)))
    .map((kit) => kit.id);

  const qrIdsOfKitsNotInBooking = Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return kitsNotInBooking.includes((item?.data as any)?.id);
    })
    .map(([qrId]) => qrId);

  // Kits that are already checked out for this booking (ALL kit assets in booking are checked out)
  const alreadyCheckedOutKits = kits
    .filter((kit) => {
      // Get kit assets that are in this booking
      const kitAssetsInBooking = kit.assets.filter((asset) =>
        bookingAssetIds.has(asset.id)
      );

      // Kit is considered already checked out only if ALL its assets in booking are checked out
      return (
        kitAssetsInBooking.length > 0 &&
        kitAssetsInBooking.every(
          (asset) =>
            asset.status === AssetStatus.CHECKED_OUT ||
            alreadyCheckedOut.has(asset.id)
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
      schema={partialCheckoutAssetsSchema}
      items={items}
      onClearItems={clearList}
      form={
        <CustomForm
          assetIdsForCheckout={assetIdsForCheckout}
          isEarlyCheckout={isEarlyCheckout}
          booking={booking}
          isLoading={isLoading}
          hasBlockers={hasBlockers}
        />
      }
      title={
        <div className="text-right">
          <span className="flex items-center justify-end gap-1 text-gray-600">
            {assetIdsForCheckout.length}/{remainingBookedAssets} Assets scanned
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
      renderItem={renderItemRow}
      Blockers={Blockers}
      defaultExpanded={defaultExpanded}
      className={tw(
        "[&_.default-base-drawer-header]:rounded-b [&_.default-base-drawer-header]:border [&_.default-base-drawer-header]:px-4 [&_thead]:hidden",
        className
      )}
      style={style}
      headerContent={<BookingHeader booking={booking} />}
    />
  );
}

// Asset row renderer
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const { booking, checkedOutAssetIds } = useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  const alreadyCheckedOut = new Set(checkedOutAssetIds || []);

  // Check if asset is in this booking
  const isInBooking = booking.assets.some((a) => a.id === asset.id);

  // Check if asset is already checked out within this booking
  const isAlreadyCheckedOut =
    asset.status === AssetStatus.CHECKED_OUT || alreadyCheckedOut.has(asset.id);

  // Check if asset is currently in custody (must be released before check-out)
  const isInCustody = asset.status === AssetStatus.IN_CUSTODY;

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
    // Custom preset for already checked out assets — in check-out context this
    // IS the relevant/blocking state, so we surface it.
    {
      condition: isAlreadyCheckedOut && isInBooking,
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
      condition: !!asset.kitId && !isRedundant, // Only show if not redundant
      badgeText: "Part of kit",
      tooltipTitle: "Asset is part of a kit",
      tooltipContent: isLastKitAssetInBooking
        ? "This is the last asset from this kit in the booking. Checking it out will also mark the entire kit as checked out."
        : "This asset belongs to a kit. Checking out this asset individually will not affect the kit status or other kit assets.",
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
  const { booking, checkedOutAssetIds } = useLoaderData<typeof loader>();
  const items = useAtomValue(scannedItemsAtom);

  // Check how many assets from this kit are in the booking
  const bookingAssetIds = new Set(booking.assets.map((a) => a.id));
  const kitAssetsInBooking = kit.assets.filter((a) =>
    bookingAssetIds.has(a.id)
  );
  const allKitAssetsInBooking = kitAssetsInBooking.length === kit.assets.length;
  const noKitAssetsInBooking = kitAssetsInBooking.length === 0;

  // Assets already checked out for this booking
  const alreadyCheckedOut = new Set(checkedOutAssetIds || []);

  const isAssetCheckedOut = (asset: { id: string; status: AssetStatus }) =>
    asset.status === AssetStatus.CHECKED_OUT || alreadyCheckedOut.has(asset.id);

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
  isEarlyCheckout: boolean;
  booking: Pick<Booking, "id" | "name" | "from" | "to">;
  isLoading?: boolean;
  hasBlockers: boolean;
};

const CustomForm = ({
  assetIdsForCheckout,
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
