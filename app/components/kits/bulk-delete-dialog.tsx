import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkDeleteKitsSchema = z.object({
  kitIds: z.array(z.string()).min(1),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<AssetIndexLoaderData>();

  const zo = useZorm("BulkDeleteKits", BulkDeleteKitsSchema);

  const selectedKits = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedKits)
    ? totalItems
    : selectedKits.length;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      title={`Delete ${totalSelected} kits`}
      description={`Are you sure you want to delete all ${totalSelected} kits? This action cannot be undone.`}
      actionUrl="/api/kits/bulk-actions"
      arrayFieldId="kitIds"
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <>
          <input type="hidden" value="bulk-delete" name="intent" />

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
