/**
 * Bulk Partial Checkout Dialog
 *
 * Renders the "Check out selected items" dialog opened from the booking
 * overview bulk-actions dropdown. It mirrors `BulkPartialCheckinDialog`:
 * the user selects assets/kits in the booking list, opens this dialog, and
 * confirms checking out the still-Booked subset.
 *
 * The set of asset IDs submitted is the selected ASSETS (kits are excluded —
 * they only provide grouping) that are part of the booking and NOT already
 * checked out. "Already checked out" means the asset id is in the loader's
 * `checkedOutAssetIds` (per-booking partial-checkout records) OR the asset's
 * own `status === CHECKED_OUT`.
 *
 * If the submitted set equals ALL still-Booked assets in the booking, this is
 * a "final" checkout; combined with `isBookingEarlyCheckout(booking.from)` it
 * becomes an early checkout and we delegate to `CheckoutDialog` so the user
 * can choose whether to adjust the start date. Otherwise a plain
 * `partial-checkout` submit is used.
 *
 * @see {@link file://./bulk-partial-checkin-dialog.tsx} — the mirror source
 * @see {@link file://./checkout-dialog.tsx} — early-checkout confirmation
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useActionData, useLoaderData } from "react-router";
import z from "zod";
import {
  clearSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
} from "~/atoms/list";
import { useDisabled } from "~/hooks/use-disabled";
import { shouldPromptEarlyCheckout } from "~/modules/booking/helpers";
import type {
  BookingPageLoaderData,
  BookingPageActionData,
} from "~/routes/_layout+/bookings.$bookingId.overview";
import type { AssetWithStatus } from "~/utils/booking-assets";
import {
  flattenSelectedBookingItems,
  isAssetCheckableOut,
} from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import CheckoutDialog from "./checkout-dialog";
import { AssetImage } from "../assets/asset-image/component";
import { Form } from "../custom-form";
import KitImage from "../kits/kit-image";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

/**
 * Validation schema for the bulk partial checkout action. At least one asset
 * id must be supplied — the action rejects empty submissions.
 */
export const BulkPartialCheckoutSchema = z.object({
  assetIds: z
    .array(z.string())
    .min(1, "Please select at least one asset to check out."),
});

/**
 * Bulk partial checkout dialog.
 *
 * @param props.open - Whether the dialog is currently visible
 * @param props.setOpen - Setter to open/close the dialog
 */
// react-doctor:no-giant-component — deferred for follow-up refactor
export default function BulkPartialCheckoutDialog({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const disabled = useDisabled();
  const { booking, checkedOutAssetIds } =
    useLoaderData<BookingPageLoaderData>();

  const rawSelectedItems = useAtomValue(selectedBulkItemsAtom);

  // Ids already checked out for THIS booking (partial-checkout records). Used
  // by the shared `isAssetCheckableOut` predicate below.
  const checkedOutIdsSet = new Set(checkedOutAssetIds || []);

  // Flatten/enrich the selection via the SHARED resolver, then keep kits + the
  // assets that are still booked (not already checked out).
  const flattenedItems = flattenSelectedBookingItems(
    rawSelectedItems,
    booking.assets
  );
  const selectedItems = flattenedItems.filter((item) => {
    if (item.type === "kit" || (item.name && item._count)) return true;
    return isAssetCheckableOut(item as AssetWithStatus, checkedOutIdsSet);
  });

  /** Use state instead of ref so the component re-renders once the form
   * mounts — this guarantees portalContainer is the real DOM node
   * when the user opens the early-checkout dialog. */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  // Still-booked assets in the booking (asset-scoped) for final-checkout
  // detection — unaffected by the kits-as-single-unit setting.
  const remainingBookedAssets = booking.assets.filter((asset) =>
    isAssetCheckableOut(asset, checkedOutIdsSet)
  );

  // Count only individual assets (exclude kit IDs), deduped, for final-checkout
  // detection and submission — the selection can contain the same asset twice
  // (e.g. scanned both standalone and as a kit member).
  const selectedAssetIds = Array.from(
    new Set(
      selectedItems
        .filter((item: any) => item.title && !item._count) // Only assets, not kits
        .map((asset: any) => asset.id)
    )
  );

  // Final checkout = the selected set IS exactly the still-Booked set. Use set
  // membership (not just count equality) so duplicates or an unrelated selection
  // of the same size can't be misread as "final".
  const remainingBookedAssetIds = new Set(
    remainingBookedAssets.map((asset) => asset.id)
  );
  const isFinalCheckout =
    selectedAssetIds.length > 0 &&
    selectedAssetIds.length === remainingBookedAssetIds.size &&
    selectedAssetIds.every((id) => remainingBookedAssetIds.has(id));

  // Early checkout is only relevant for final checkouts of a still-RESERVED
  // booking (checking out the whole remaining booking before the start date).
  // Once the booking is ONGOING/OVERDUE the start date is fixed and the date
  // choice is ignored server-side, so the prompt would be a confusing no-op.
  const isEarlyCheckout = Boolean(
    isFinalCheckout && shouldPromptEarlyCheckout(booking.status, booking.from)
  );

  function handleCloseDialog() {
    setOpen(false);
  }

  const [shouldClose, setShouldClose] = useState(false);

  const actionData = useActionData<BookingPageActionData>();

  // Clear the bulk selection once the action succeeds so the user does not need
  // to manually "unselect all" before selecting the next batch.
  const clearSelectedBulkItems = useSetAtom(clearSelectedBulkItemsAtom);

  // First, detect when we get a success response.
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setShouldClose(true);
    }
  }, [actionData]);

  // Then, close the dialog when revalidation completes.
  useEffect(() => {
    if (shouldClose && !disabled) {
      setOpen(false);
      setShouldClose(false); // Reset for future uses
      clearSelectedBulkItems();
    }
  }, [shouldClose, disabled, setOpen, clearSelectedBulkItems]);

  // No assets remain to check out — disable the submit affordance.
  const noAssetsToCheckOut = selectedAssetIds.length === 0;

  // Assets dropped from the selection because they are already checked out.
  const skippedCount =
    new Set(flattenedItems.filter((i) => i.title && !i._count).map((i) => i.id))
      .size - selectedAssetIds.length;

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleCloseDialog}
        className={tw("bulk-tagging-dialog lg:w-[400px]")}
        title={
          <div className="w-full">
            <div className={tw("mb-2")}>
              <h4>Check out selected items</h4>
              <p>
                The following items will be checked out and marked as Checked
                out.
              </p>
            </div>
          </div>
        }
      >
        <Form
          method="post"
          className="px-6 pb-6"
          ref={setFormElement}
          id="bulk-partial-checkout-form"
        >
          <input type="hidden" name="returnJson" value="true" />

          {/* Only deduped asset IDs are sent to the backend (kits excluded). */}
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
              {skippedCount === 1 ? "is" : "are"} already checked out and will
              be skipped.
            </p>
          )}

          {/* List of items being checked out */}
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

              // Group assets by kit and filter out kits with no assets to check out
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

            {/* Submit button - conditional based on early check-out. The
                CheckoutDialog submits this same form (carrying the hidden
                assetIds + returnJson). We pass intent="partial-checkout" so the
                overview action routes to checkoutAssets/partialCheckoutBooking
                (which records the batch + applies the date choice) rather than
                the whole-booking checkoutBooking that the default intent would
                trigger on this intent-routed page. */}
            {isEarlyCheckout ? (
              <CheckoutDialog
                booking={{
                  id: booking.id,
                  name: booking.name,
                  from: booking.from,
                }}
                intent="partial-checkout"
                disabled={disabled || noAssetsToCheckOut}
                portalContainer={formElement || undefined}
                formId="bulk-partial-checkout-form"
                fullWidth
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={disabled || noAssetsToCheckOut}
                name="intent"
                value="partial-checkout"
                className="whitespace-nowrap"
              >
                Check out items
              </Button>
            )}
          </div>
        </Form>
      </Dialog>
    </DialogPortal>
  );
}
