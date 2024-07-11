import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { loader } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkDeleteAssetsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<typeof loader>();
  const zo = useZorm("BulkDeleteAssets", BulkDeleteAssetsSchema);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedAssets)
    ? totalItems
    : selectedAssets.length;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      title={`Delete (${totalSelected}) assets`}
      description={`Are you sure you want to delete all (${totalSelected}) assets? This action cannot be undone.`}
      actionUrl="."
      arrayFieldId="assetIds"
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
