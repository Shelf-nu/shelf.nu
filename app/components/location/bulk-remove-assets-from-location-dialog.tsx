import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { selectedBulkItemsCountAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkRemoveAssetsFromLocationSchema = z.object({
  assetIds: z.array(z.string()).min(1, "Please select at least one asset."),
});

export default function BulkRemoveAssetsFromLocationDialog() {
  const zo = useZorm(
    "BulkRemoveAssetsFromLocation",
    BulkRemoveAssetsFromLocationSchema
  );
  const totalSelectedItems = useAtomValue(selectedBulkItemsCountAtom);
  const { location } = useLoaderData<{ location: { id: string } }>();

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      title={`Remove selected assets (${totalSelectedItems})`}
      arrayFieldId="assetIds"
      description={`Are you sure you want to remove ${totalSelectedItems} selected asset(s) from this location?`}
      actionUrl={`/locations/${location.id}/assets`}
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <>
          <input type="hidden" name="intent" value="bulk-remove-assets" />

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
