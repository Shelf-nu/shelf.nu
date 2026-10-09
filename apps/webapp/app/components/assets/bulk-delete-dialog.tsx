import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkDeleteConfirmation } from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

export const BulkDeleteAssetsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<AssetIndexLoaderData>();
  const zo = useZorm("BulkDeleteAssets", BulkDeleteAssetsSchema);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedAssets)
    ? totalItems
    : selectedAssets.length;
  const noun = totalSelected === 1 ? "asset" : "assets";

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      title={`Delete ${totalSelected} ${noun}`}
      description={`This permanently deletes ${totalSelected} ${noun} with their notes, custody, reminders and custom field values, and removes them from every booking, kit and audit. Their QR codes are unlinked. This cannot be undone.`}
      actionUrl="."
      arrayFieldId="assetIds"
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
