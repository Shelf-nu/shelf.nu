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
import { AssetStatus } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useActionData, useLoaderData } from "react-router";
import z from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useDisabled } from "~/hooks/use-disabled";
import { isBookingEarlyCheckout } from "~/modules/booking/helpers";
import type {
  BookingPageLoaderData,
  BookingPageActionData,
} from "~/routes/_layout+/bookings.$bookingId.overview";
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

  let selectedItems = useAtomValue(selectedBulkItemsAtom);

  // Create a map for quick asset lookup so we can enrich the selection with
  // the booking-scoped asset record (which carries `status`, `kitId`, etc.).
  const bookingAssetsMap = new Map(
    booking.assets.map((asset) => [asset.id, asset])
  );

  // Set of asset ids already checked out for THIS booking (partial-checkout
  // records). Asset `status === CHECKED_OUT` is checked separately below.
  const checkedOutIdsSet = new Set(checkedOutAssetIds || []);

  /**
   * An asset is "already checked out" for this booking when it appears in the
   * per-booking partial-checkout records OR its own status is CHECKED_OUT.
   */
  function isAssetAlreadyCheckedOut(asset: any): boolean {
    return (
      checkedOutIdsSet.has(asset.id) || asset.status === AssetStatus.CHECKED_OUT
    );
  }

  // Enrich selection data with booking asset information and filter out assets
  // that are already checked out (kits are kept regardless — they only group).
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
      // Only keep assets that are still booked (not already checked out)
      return !isAssetAlreadyCheckedOut(item);
    });

  /** Use state instead of ref so the component re-renders once the form
   * mounts — this guarantees portalContainer is the real DOM node
   * when the user opens the early-checkout dialog. */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  // Determine whether this is a FINAL checkout: the assets being checked out
  // equal ALL still-Booked assets in the booking. Count still-Booked assets
  // directly (asset-scoped) so the comparison is unaffected by the
  // kits-as-single-unit setting that `lifecycleProgress` may apply.
  const remainingBookedAssets = booking.assets.filter(
    (asset) => !isAssetAlreadyCheckedOut(asset)
  );

  // Count only individual assets (exclude kit IDs) for final-checkout detection.
  const selectedAssetIds = selectedItems
    .filter((item: any) => item.title && !item._count) // Only assets, not kits
    .map((asset: any) => asset.id);

  const isFinalCheckout =
    selectedAssetIds.length === remainingBookedAssets.length &&
    remainingBookedAssets.length > 0;

  // Early checkout is only relevant for final checkouts (checking out the whole
  // remaining booking before the start date).
  const isEarlyCheckout = Boolean(
    isFinalCheckout && isBookingEarlyCheckout(booking.from)
  );

  function handleCloseDialog() {
    setOpen(false);
  }

  const [shouldClose, setShouldClose] = useState(false);

  const actionData = useActionData<BookingPageActionData>();

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
    }
  }, [shouldClose, disabled, setOpen]);

  // No assets remain to check out — disable the submit affordance.
  const noAssetsToCheckOut = selectedAssetIds.length === 0;

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleCloseDialog}
        className={tw("bulk-tagging-dialog lg:w-[400px]")}
        title={
          <div className="w-full">
            <div className={tw("mb-5")}>
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
