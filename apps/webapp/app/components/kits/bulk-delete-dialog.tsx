import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkDeleteConfirmation } from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

export const BulkDeleteKitsSchema = z.object({
  kitIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<AssetIndexLoaderData>();

  const zo = useZorm("BulkDeleteKits", BulkDeleteKitsSchema);

  const selectedKits = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedKits)
    ? totalItems
    : selectedKits.length;
  const noun = totalSelected === 1 ? "kit" : "kits";

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      title={`Delete ${totalSelected} ${noun}`}
      description={`This permanently deletes ${totalSelected} ${noun}. Their assets stay in your workspace and keep their location, but leave the draft and reserved bookings the kits were on. Kit custody is released and kit QR codes are unlinked. This cannot be undone.`}
      actionUrl="/api/kits/bulk-actions"
      arrayFieldId="kitIds"
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
