/**
 * Bulk Asset Model Remove Dialog
 *
 * Takes the selected assets out of whatever asset model they belong to. Its
 * own menu item and dialog rather than an option inside the assign picker, so
 * that picker lists nothing but real asset models, and so the destructive
 * direction has to be chosen deliberately. Same shape as the Remove tags and
 * Remove from kit pair.
 *
 * Posts to the same endpoint as the assign dialog with an empty
 * `assetModelId`, which the service reads as "unlink".
 *
 * @see {@link file://./bulk-asset-model-update-dialog.tsx} the assign half
 * @see {@link file://./../../routes/api+/assets.bulk-update-asset-model.ts} action
 */
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

const BulkAssetModelRemoveSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

export default function BulkAssetModelRemoveDialog() {
  const { totalItems } = useLoaderData<AssetIndexLoaderData>();
  const zo = useZorm("BulkAssetModelRemove", BulkAssetModelRemoveSchema);

  const selectedItems = useAtomValue(selectedBulkItemsAtom);

  /** Same reason as the assign dialog: the shared count atom would report the page size. */
  const totalSelected = isSelectingAllItems(selectedItems)
    ? totalItems
    : selectedItems.length;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="asset-model-remove"
      arrayFieldId="assetIds"
      /**
       * The endpoint is named after the assign action, so it has to be passed
       * explicitly here — the shared dialog otherwise derives
       * `/api/assets/bulk-update-asset-model-remove`, which does not exist.
       */
      actionUrl="/api/assets/bulk-update-asset-model"
      title={`Remove (${totalSelected}) assets from their asset model`}
      description="The assets keep everything else. Only the link to their asset model is removed."
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div>
          {/* Empty is what the service reads as "unlink". */}
          <input type="hidden" name="assetModelId" value="" />

          {fetcherError ? (
            <p role="alert" className="mb-4 text-sm text-error-500">
              {fetcherError}
            </p>
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
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
