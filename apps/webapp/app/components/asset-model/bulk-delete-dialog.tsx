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
import {
  BulkDeleteConfirmation,
  bulkDeleteCount,
} from "../bulk-update-dialog/bulk-delete-confirmation";
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

  /** The dialog's words for `count` items, re-read after a refused count. */
  const describe = (count: number) => {
    const noun = count === 1 ? "asset model" : "asset models";
    return {
      title: `Delete ${count} ${noun}`,
      description: `This permanently deletes ${count} ${noun}. Their assets are kept but lose the model, and every booking reservation made by ${
        count === 1 ? "this model" : "these models"
      } is removed. This cannot be undone.`,
    };
  };

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      arrayFieldId="assetModelIds"
      actionUrl="/settings/asset-models"
      title={({ fetcherErrorAdditionalData }) =>
        describe(bulkDeleteCount(totalSelected, fetcherErrorAdditionalData))
          .title
      }
      description={({ fetcherErrorAdditionalData }) =>
        describe(bulkDeleteCount(totalSelected, fetcherErrorAdditionalData))
          .description
      }
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
