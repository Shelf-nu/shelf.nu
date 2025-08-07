import { useCallback, useRef } from "react";
import { AssetStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import z from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId";
import CheckinDialog from "./checkin-dialog";
import { AssetImage } from "../assets/asset-image/component";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import KitImage from "../kits/kit-image";
import { Button } from "../shared/button";

export const BulkPartialCheckinSchema = z.object({
  assetIds: z
    .array(z.string())
    .min(1, "Please select at least one asset to check in."),
});

export default function BulkPartialCheckinDialog() {
  const zo = useZorm("BulkPartialCheckin", BulkPartialCheckinSchema);
  const totalSelectedItems = useAtomValue(selectedBulkItemsCountAtom);
  let selectedItems = useAtomValue(selectedBulkItemsAtom);
  selectedItems = selectedItems.filter(
    (a) => a.status === AssetStatus.CHECKED_OUT
  );
  // Create a mutable ref object for the portal container
  const formRef = useRef<{ current: HTMLFormElement | null }>({
    current: null,
  });

  const { booking } = useLoaderData<BookingPageLoaderData>();

  // Check if this would be a final check-in (all remaining CHECKED_OUT assets are being selected)
  const remainingCheckedOutAssets = booking.assets.filter(
    (asset) => asset.status === "CHECKED_OUT"
  );
  const isFinalCheckin =
    selectedItems.length === remainingCheckedOutAssets.length &&
    remainingCheckedOutAssets.length > 0;

  // Check if it's an early check-in (only relevant for final check-ins)
  const isEarlyCheckin = Boolean(
    isFinalCheckin && booking.to && isBookingEarlyCheckin(booking.to)
  );

  // Form ID for CheckinDialog to reference
  const formId = `bulk-partial-checkin-form-${booking.id}`;

  // Combined ref callback for both zo.ref and formRef
  const combinedRef = useCallback(
    (form: HTMLFormElement | null) => {
      zo.ref(form);
      formRef.current.current = form;
      // Set the form ID when available
      if (form && !form.id) {
        form.id = formId;
      }
    },
    [zo, formId]
  );

  return (
    <BulkUpdateDialogContent
      ref={combinedRef}
      type="partial-checkin"
      title={`Check in selected items`}
      arrayFieldId="__unused" // We manually add assetIds above to filter out kits
      description={`The following items will be checked in and marked as Available.`}
      actionUrl={`/bookings/${booking.id}/checkin-assets`}
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <>
          {/* Hidden field to request JSON response */}
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

              // Group assets by kit
              const kitGroups = kits.map((kit: any) => {
                const kitAssets = assets.filter(
                  (asset: any) => asset.kitId === kit.id
                );
                return { kit, assets: kitAssets };
              });

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

          {fetcherError ? (
            <p className="mb-4 text-sm text-error-500">{fetcherError}</p>
          ) : null}

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
                label={`Check in ${totalSelectedItems} item${
                  totalSelectedItems !== 1 ? "s" : ""
                }`}
                variant="primary"
                disabled={disabled}
                formId={formId}
                portalContainer={formRef.current.current || undefined}
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={disabled}
              >
                Check in items
              </Button>
            )}
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
