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
import { BulkDeleteConfirmation } from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

export const BulkDeleteAssetModelSchema = z.object({
  assetModelIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
});

export default function AssetModelBulkDeleteDialog() {
  const { totalItems } = useLoaderData<typeof loader>();

  const zo = useZorm("BulkDeleteAssetModels", BulkDeleteAssetModelSchema);

  const selectedAssetModels = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedAssetModels)
    ? totalItems
    : selectedAssetModels.length;
  const noun = totalSelected === 1 ? "asset model" : "asset models";

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      arrayFieldId="assetModelIds"
      actionUrl="/settings/asset-models"
      title={`Delete ${totalSelected} ${noun}`}
      description={`This permanently deletes ${totalSelected} ${noun}. Their assets are kept but lose the model, and every booking reservation made by ${
        totalSelected === 1 ? "this model" : "these models"
      } is removed. This cannot be undone.`}
    >
      {({
        fetcherError,
        fetcherErrorAdditionalData,
        disabled,
        handleCloseDialog,
      }) => (
        <>
          <input type="hidden" value="bulk-delete" name="intent" />
          <BulkDeleteConfirmation
            count={totalSelected}
            disabled={disabled}
            fetcherError={fetcherError}
            fetcherErrorAdditionalData={fetcherErrorAdditionalData}
            onCancel={handleCloseDialog}
          />
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
