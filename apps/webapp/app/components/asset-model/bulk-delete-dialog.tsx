/**
 * Bulk delete dialog for asset models.
 * Renders the confirmation dialog content used by the bulk actions dropdown.
 */
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { type loader } from "~/routes/_layout+/settings.asset-models.index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkDeleteAssetModelSchema = z.object({
  assetModelIds: z.array(z.string()).min(1),
});

export default function AssetModelBulkDeleteDialog() {
  const { totalItems } = useLoaderData<typeof loader>();

  const zo = useZorm("BulkDeleteAssetModels", BulkDeleteAssetModelSchema);

  const selectedAssetModels = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedAssetModels)
    ? totalItems
    : selectedAssetModels.length;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      arrayFieldId="assetModelIds"
      actionUrl="/settings/asset-models"
      title={`Delete ${totalSelected} asset models`}
      description={`Are you sure you want to delete all ${totalSelected} asset models? This action cannot be undone.`}
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <>
          <input type="hidden" value="bulk-delete" name="intent" />

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
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
            >
              Confirm
            </Button>
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
