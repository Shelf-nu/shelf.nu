import { useEffect, useRef, useState } from "react";
import { AssetStatus } from "@prisma/client";
import { useActionData, useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import z from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { useDisabled } from "~/hooks/use-disabled";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import type {
  BookingPageLoaderData,
  BookingPageActionData,
} from "~/routes/_layout+/bookings.$bookingId";
import { getBookingContextAssetStatus } from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import CheckinDialog from "./checkin-dialog";
import { AssetImage } from "../assets/asset-image/component";
import { Form } from "../custom-form";
import KitImage from "../kits/kit-image";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
export const BulkPartialCheckinSchema = z.object({
  assetIds: z
    .array(z.string())
    .min(1, "Please select at least one asset to check in."),
});
export default function BulkPartialCheckinDialog({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const disabled = useDisabled();
  const totalSelectedItems = useAtomValue(selectedBulkItemsCountAtom);
  const { booking, partialCheckinProgress, partialCheckinDetails } =
    useLoaderData<BookingPageLoaderData>();

  let selectedItems = useAtomValue(selectedBulkItemsAtom);

  // Create a map for quick asset lookup
  const bookingAssetsMap = new Map(
    booking.assets.map((asset) => [asset.id, asset])
  );

  // Enrich selection data with booking asset information and filter for CHECKED_OUT
  selectedItems = selectedItems
    .flatMap((item: any) => {
      // Handle pagination wrapper objects (has type: "asset" and assets array)
      if (item.type === "asset" && item.assets) {
        return item.assets.map((asset: any) => {
          const bookingAsset = bookingAssetsMap.get(asset.id);
          return bookingAsset ? { ...asset, ...bookingAsset } : asset;
        });
      }

      // Handle kit objects (has type: "kit")
      if (item.type === "kit") {
        // Flatten kit properties to match rendering expectations
        const flattenedKit = {
          ...item,
          name: item.kit?.name,
          _count: item.kit?._count,
        };
        return flattenedKit;
      }

      // Handle kit objects with traditional structure (has name and _count, not title)
      if (item.name && item._count) {
        return item; // Return kit as-is, no need to filter by status
      }

      // Handle direct asset objects (has title, not name)
      if (item.title) {
        const bookingAsset = bookingAssetsMap.get(item.id);
        return bookingAsset ? { ...item, ...bookingAsset } : item;
      }

      return item; // Fallback for any other structure
    })
    .filter((item) => {
      // Keep kits regardless of status (both type structures)
      if (item.type === "kit" || (item.name && item._count)) return true;
      const contextStatus = getBookingContextAssetStatus(
        item,
        partialCheckinDetails,
        booking.status
      );
      // Only keep assets that are CHECKED_OUT
      return contextStatus === AssetStatus.CHECKED_OUT;
    });

  // Create a mutable ref object for the portal container
  const formRef = useRef<HTMLFormElement>(null);

  // Check if this would be a final check-in (all remaining CHECKED_OUT assets are being selected)
  // Need to exclude assets that have already been checked in through partial check-ins
  const checkedInAssetIds = new Set(
    partialCheckinProgress?.checkedInAssetIds || []
  );
  const remainingCheckedOutAssets = booking.assets.filter(
    (asset) =>
      asset.status === "CHECKED_OUT" && !checkedInAssetIds.has(asset.id)
  );
  // Count only individual assets (exclude kit IDs) for final check-in detection
  const selectedAssetIds = selectedItems
    .filter((item: any) => item.title && !item._count) // Only assets, not kits
    .map((asset: any) => asset.id);

  const isFinalCheckin =
    selectedAssetIds.length === remainingCheckedOutAssets.length &&
    remainingCheckedOutAssets.length > 0;

  // Check if it's an early check-in (only relevant for final check-ins)
  const isEarlyCheckin = Boolean(
    isFinalCheckin && booking.to && isBookingEarlyCheckin(booking.to)
  );

  function handleCloseDialog() {
    setOpen(false);
  }

  const [shouldClose, setShouldClose] = useState(false);

  const actionData = useActionData<BookingPageActionData>();

  // First, detect when we get a success response
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setShouldClose(true);
    }
  }, [actionData]);

  // Then, close the dialog when revalidation completes
  useEffect(() => {
    if (shouldClose && !disabled) {
      setOpen(false);
      setShouldClose(false); // Reset for future uses
    }
  }, [shouldClose, disabled, setOpen]);

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleCloseDialog}
        className={tw("bulk-tagging-dialog lg:w-[400px]")}
        title={
          <div className="w-full">
            <div className={tw("mb-5")}>
              <h4>Check in selected items</h4>
              <p>
                The following items will be checked in and marked as Available.
              </p>
            </div>
          </div>
        }
      >
        <Form method="post" className="px-6 pb-6" ref={formRef}>
          <input type="hidden" name="returnJson" value="true" />

          {/* Filter out kit IDs - only send asset IDs to backend */}
          {selectedItems
            .filter((item: any) => item.title && !item._count) // Only assets, not kits
            .map((asset: any, index: number) => (
              <input
                key={asset.id}
                type="hidden"
                name={`assetIds[${index}]`}
                value={asset.id}
              />
            ))}

          {/* List of items being checked in */}
          <div className="mb-4 max-h-48 overflow-y-auto rounded border bg-gray-50 p-3">
            {(() => {
              // Separate kits and individual assets
              const kits = selectedItems.filter(
                (item: any) => item.name && item._count
              );
              const assets = selectedItems.filter(
                (item: any) => item.title && !item._count
              );
              const individualAssets = assets.filter(
                (asset: any) => !asset.kitId
              );

              // Group assets by kit and filter out kits with no assets to check in
              const kitGroups = kits
                .map((kit: any) => {
                  const kitAssets = assets.filter(
                    (asset: any) => asset.kitId === kit.id
                  );
                  return { kit, assets: kitAssets };
                })
                .filter(({ assets: kitAssets }) => kitAssets.length > 0);

              return (
                <div className="space-y-3">
                  {/* Kit groups */}
                  {kitGroups.map(({ kit, assets: kitAssets }) => (
                    <div key={kit.id}>
                      {/* Kit header */}
                      <div className="flex items-center gap-2">
                        <KitImage
                          kit={{
                            kitId: kit.id,
                            image: kit.mainImage,
                            imageExpiration: kit.mainImageExpiration,
                            alt: `${kit.name} kit image`,
                          }}
                          className="size-5"
                        />
                        <span className="text-sm font-medium">{kit.name}</span>
                        <span className="text-xs text-gray-500">
                          ({kitAssets.length} assets)
                        </span>
                        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                          KIT
                        </span>
                      </div>

                      {/* Kit assets */}
                      <ul className="ml-6 mt-2 space-y-1">
                        {kitAssets.map((asset: any) => (
                          <li
                            key={asset.id}
                            className="flex items-center gap-2 text-sm text-gray-700"
                          >
                            <AssetImage
                              className="size-5"
                              asset={{
                                id: asset.id,
                                thumbnailImage: asset.thumbnailImage,
                                mainImage: asset.mainImage,
                                mainImageExpiration: asset.mainImageExpiration,
                              }}
                              alt={`${asset.title} main image`}
                            />
                            <span className="font-medium">{asset.title}</span>
                            {asset.category && (
                              <span className="text-gray-500">
                                {" "}
                                ({asset.category.name})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  {/* Individual assets (not part of kits) */}
                  {individualAssets.length > 0 && (
                    <ul className="space-y-1">
                      {individualAssets.map((asset: any) => (
                        <li
                          key={asset.id}
                          className="flex items-center gap-2 text-sm text-gray-700"
                        >
                          <AssetImage
                            className="size-5"
                            asset={{
                              id: asset.id,
                              thumbnailImage: asset.thumbnailImage,
                              mainImage: asset.mainImage,
                              mainImageExpiration: asset.mainImageExpiration,
                            }}
                            alt={`${asset.title} main image`}
                          />
                          <span className="font-medium">{asset.title}</span>
                          {asset.category && (
                            <span className="text-gray-500">
                              {" "}
                              ({asset.category.name})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          </div>

          {/* {fetcherError ? (
            <p className="mb-4 text-sm text-error-500">{fetcherError}</p>
          ) : null} */}

          <div className="flex gap-3">
            <Button
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>

            {/* Submit button - conditional based on early check-in */}
            {isEarlyCheckin ? (
              <CheckinDialog
                booking={{
                  id: booking.id,
                  name: booking.name,
                  to: booking.to!,
                  from: booking.from!,
                }}
                label={`Check in  item${totalSelectedItems !== 1 ? "s" : ""}`}
                variant="primary"
                disabled={disabled}
                portalContainer={formRef.current || undefined}
                onClose={handleCloseDialog}
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={disabled}
                name="intent"
                value="partial-checkin"
              >
                Check in items
              </Button>
            )}
          </div>
        </Form>
      </Dialog>
    </DialogPortal>
  );
}
