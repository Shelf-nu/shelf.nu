import { useLoaderData } from "react-router";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import z from "zod";
import { selectedBulkItemsCountAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkRemoveAssetsAndKitSchema = z.object({
  assetOrKitIds: z
    .array(z.string())
    .min(1, "Please select at least one asset or kit."),
});

export default function BulkRemoveAssetAndKitDialog() {
  const zo = useZorm("BulkRemoveAssetAndKit", BulkRemoveAssetsAndKitSchema);
  const totalSelectedItems = useAtomValue(selectedBulkItemsCountAtom);
  const { booking } = useLoaderData<{ booking: { id: string } }>();

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

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
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
            <Button
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
