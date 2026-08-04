import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkRemoveAssetsAndKitSchema = z.object({
  assetOrKitIds: z
    .array(z.string())
    .min(1, "Please select at least one asset or kit."),
  /**
   * Asset ids whose *standalone* booking row the user ticked directly.
   *
   * `assetOrKitIds` alone can't express this: ticking a kit injects its
   * member rows into the selection, so a member's asset id is present in
   * the payload whether the user ticked its standalone row or not. Without
   * this field the server has to guess, and it guesses "kit member" — which
   * left the standalone row of an asset booked BOTH ways on the booking.
   */
  standaloneAssetIds: z.array(z.string()).optional().default([]),
});

export default function BulkRemoveAssetAndKitDialog() {
  const zo = useZorm("BulkRemoveAssetAndKit", BulkRemoveAssetsAndKitSchema);
  const totalSelectedItems = useAtomValue(selectedBulkItemsCountAtom);
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const { booking } = useLoaderData<{ booking: { id: string } }>();

  /**
   * Standalone rows in the selection: asset rows (they carry a
   * `bookingAssetId`) that were booked outside any kit (`kitId` null).
   * Kit rows have no `bookingAssetId`; kit-driven asset rows have a
   * `kitId`. Each (booking, asset) pair can hold at most one standalone
   * row — enforced by the partial unique index on `BookingAsset` — so the
   * asset id identifies the row unambiguously once paired with the
   * `assetKitId IS NULL` predicate the server applies.
   */
  const standaloneAssetIds = selectedItems
    .filter((item) => item.bookingAssetId && !item.kitId)
    .map((item) => item.id);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      title={`Remove selected items (${totalSelectedItems})`}
      arrayFieldId="assetOrKitIds"
      description={`Are you sure you want to remove ${totalSelectedItems} selected item(s)? This action cannot be undone.`}
      actionUrl={`/bookings/${booking.id}/overview`}
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <>
          <input type="hidden" name="intent" value="bulk-remove-asset-or-kit" />

          {standaloneAssetIds.map((assetId, i) => (
            <input
              key={`standalone-${assetId}`}
              type="hidden"
              name={`standaloneAssetIds[${i}]`}
              value={assetId}
            />
          ))}

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

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
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled}
              className="border-error-600 bg-error-600 hover:border-error-800 hover:!bg-error-800"
            >
              Confirm
            </Button>
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
