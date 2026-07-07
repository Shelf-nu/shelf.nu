import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useActionData, useLoaderData } from "react-router";
import z from "zod";
import {
  clearSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { useDisabled } from "~/hooks/use-disabled";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import type {
  BookingPageLoaderData,
  BookingPageActionData,
} from "~/routes/_layout+/bookings.$bookingId.overview";
import type { AssetWithStatus } from "~/utils/booking-assets";
import {
  flattenSelectedBookingItems,
  isAssetCheckableIn,
} from "~/utils/booking-assets";
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
// react-doctor:no-giant-component — deferred for follow-up refactor
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

  const rawSelectedItems = useAtomValue(selectedBulkItemsAtom);

  // Denormalised view of `booking.bookingAssets` (the QT pivot). We flatten
  // the pivot to a plain asset list shape so the SHARED resolver
  // (`flattenSelectedBookingItems`) — authored against the old `booking.assets`
  // array — can enrich entries by id without needing to know about the pivot.
  // Preserves `bookingAssetId` (used as React key for per-slice hidden inputs),
  // `bookedQuantity`, and resolves the row's kit attribution via
  // `BookingAsset.assetKitId` so a qty-tracked asset booked as both standalone
  // and kit-member surfaces under the right group.
  const assetsList = useMemo(
    () =>
      booking.bookingAssets.map((ba) => {
        // Resolve the per-row kit attribution by matching this BookingAsset's
        // `assetKitId` (the per-row pivot discriminator) against the asset's
        // set of `AssetKit` memberships. A qty-tracked asset can be a member
        // of multiple kits and appear in this booking as both a standalone
        // slice (`assetKitId IS NULL`) and a kit-driven slice — only the
        // membership whose `id` matches contributes its kit identity to this
        // row. Mirrors the loader's `bookingAssets` flattening at
        // `bookings.$bookingId.overview.tsx` (~L273) so the shared resolver
        // sees the same shape from both sides.
        const sourceKit = ba.assetKitId
          ? ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId) ?? null
          : null;
        return {
          ...ba.asset,
          bookingAssetId: ba.id,
          bookedQuantity: ba.quantity,
          kitId: sourceKit?.kitId ?? null,
          kit: sourceKit?.kit ?? null,
        };
      }),
    [booking.bookingAssets]
  );

  // Flatten/enrich the selection via the SHARED resolver (single source of
  // truth with the dropdown and checkout dialog), then keep kits + the assets
  // that are actually checkable-in.
  const flattenedItems = flattenSelectedBookingItems(
    rawSelectedItems,
    assetsList
  );
  const selectedItems = flattenedItems.filter((item) => {
    if (item.type === "kit" || (item.name && item._count)) return true;
    return isAssetCheckableIn(
      item as AssetWithStatus,
      partialCheckinDetails,
      booking.status
    );
  });

  // Distinct selected vs. eligible asset ids, for the skip-note and submit
  // guard. Kits (which carry _count) are excluded — only assets are submitted.
  const allSelectedAssetIds = new Set(
    flattenedItems.filter((i) => i.title && !i._count).map((i) => i.id)
  );
  const eligibleAssetIds = new Set(
    selectedItems.filter((i) => i.title && !i._count).map((i) => i.id)
  );
  const skippedCount = allSelectedAssetIds.size - eligibleAssetIds.size;
  const noAssetsToCheckIn = eligibleAssetIds.size === 0;

  /** Use state instead of ref so the component re-renders once the form
   * mounts — this guarantees portalContainer is the real DOM node
   * when the user opens the early-checkin dialog. */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  // Check if this would be a final check-in (all remaining CHECKED_OUT assets are being selected)
  // Need to exclude assets that have already been checked in through partial check-ins
  const checkedInAssetIds = new Set(
    partialCheckinProgress?.checkedInAssetIds || []
  );
  // Source remaining-CHECKED_OUT assets from the denormalised `assetsList`
  // (pivot-aware) — `booking.assets` was the pre-pivot shape and no longer
  // exists. Check-in eligibility is fully encoded in `partialCheckinDetails`
  // (see `isAssetCheckableIn`), so we only need the plain status probe here
  // to detect the "final checkin" case.
  const remainingCheckedOutAssets = assetsList.filter(
    (asset) =>
      asset.status === "CHECKED_OUT" && !checkedInAssetIds.has(asset.id)
  );
  // Deduped asset ids being checked in (kits excluded). The selection can
  // contain the same asset twice (e.g. selected standalone and as a kit
  // member), so reuse the eligibleAssetIds Set to guarantee uniqueness for both
  // final-checkin detection and submission.
  const selectedAssetIds = Array.from(eligibleAssetIds);

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

  // Clear the bulk selection once the action succeeds so the user does not need
  // to manually "unselect all" before selecting the next batch.
  const clearSelectedBulkItems = useSetAtom(clearSelectedBulkItemsAtom);

  // Tracks whether the latest submission came from THIS dialog. Both bulk
  // dialogs are always mounted and share useActionData, so without this guard
  // any successful overview action (e.g. saving notification recipients) would
  // close this dialog and clear the user's selection.
  const submittedRef = useRef(false);

  // First, detect a successful response, but only for a submission this dialog
  // initiated (submittedRef is set by the form's onSubmit below).
  useEffect(() => {
    if (!submittedRef.current) return;
    if (actionData && "success" in actionData && actionData.success) {
      setShouldClose(true);
    } else if (actionData) {
      // Our submission resolved without success (e.g. a validation error), so
      // stop tracking; a later unrelated success must not trigger close/clear.
      submittedRef.current = false;
    }
  }, [actionData]);

  // Then, close the dialog and clear the selection once revalidation completes.
  useEffect(() => {
    if (shouldClose && !disabled) {
      setOpen(false);
      setShouldClose(false); // Reset for future uses
      clearSelectedBulkItems();
      submittedRef.current = false;
    }
  }, [shouldClose, disabled, setOpen, clearSelectedBulkItems]);

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleCloseDialog}
        className={tw("bulk-tagging-dialog lg:w-[400px]")}
        title={
          <div className="w-full">
            <div className={tw("mb-2")}>
              <h4>Check in selected items</h4>
              <p>
                The following items will be checked in and marked as Available.
              </p>
            </div>
          </div>
        }
      >
        <Form
          method="post"
          className="px-6 pb-6"
          ref={setFormElement}
          id="bulk-partial-checkin-form"
          onSubmit={() => {
            submittedRef.current = true;
          }}
        >
          <input type="hidden" name="returnJson" value="true" />

          {/* Deduped asset ids only (kits excluded); same list used for
              final-checkin detection above. */}
          {selectedAssetIds.map((assetId: string, index: number) => (
            <input
              key={assetId}
              type="hidden"
              name={`assetIds[${index}]`}
              value={assetId}
            />
          ))}

          {skippedCount > 0 && (
            <p className="mb-3 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800">
              {skippedCount} selected item{skippedCount === 1 ? "" : "s"}{" "}
              {skippedCount === 1 ? "is" : "are"} not eligible for check-in and
              will be skipped.
            </p>
          )}

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
              type="button"
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
                  to: booking.to,
                  from: booking.from,
                }}
                label={`Check in  item${totalSelectedItems !== 1 ? "s" : ""}`}
                variant="primary"
                disabled={disabled}
                portalContainer={formElement || undefined}
                formId="bulk-partial-checkin-form"
                onClose={handleCloseDialog}
                specificAssetIds={selectedAssetIds}
                fullWidth
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={disabled || noAssetsToCheckIn}
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
