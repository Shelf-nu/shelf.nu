import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { type loader } from "~/routes/_layout+/tags";
import { isSelectingAllItems } from "~/utils/list";
import { BulkDeleteConfirmation } from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

export const BulkDeleteTagsSchema = z.object({
  tagIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<typeof loader>();

  const zo = useZorm("BulkDeleteTags", BulkDeleteTagsSchema);

  const selectedTags = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedTags)
    ? totalItems
    : selectedTags.length;
  const noun = totalSelected === 1 ? "tag" : "tags";

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      arrayFieldId="tagIds"
      actionUrl="/api/tags/bulk-actions"
      title={`Delete ${totalSelected} ${noun}`}
      description={`This permanently deletes ${totalSelected} ${noun} and removes them from every asset and booking that has them. The assets and bookings are kept. This cannot be undone.`}
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
