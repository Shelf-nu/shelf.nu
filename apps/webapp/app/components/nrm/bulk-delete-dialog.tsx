import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { type loader } from "~/routes/_layout+/settings.team.nrm";
import { isSelectingAllItems } from "~/utils/list";
import {
  BulkDeleteConfirmation,
  bulkDeleteCount,
} from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

export const BulkDeleteNRMSchema = z.object({
  nrmIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
  /**
   * The index's search params at submit time, emitted by
   * `BulkUpdateDialogContent`. Needed so a select-all delete stays scoped to
   * the rows matching the active search rather than every NRM in the org.
   */
  currentSearchParams: z.string().optional(),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<typeof loader>();

  const zo = useZorm("BulkDeleteNRMs", BulkDeleteNRMSchema);

  const selectedNRMs = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedNRMs)
    ? totalItems
    : selectedNRMs.length;

  /** The dialog's words for `count` items, re-read after a refused count. */
  const describe = (count: number) => {
    const noun =
      count === 1 ? "non-registered member" : "non-registered members";
    return {
      title: `Delete ${count} ${noun}`,
      description: `This deletes ${count} ${noun}. Their past bookings and activity are kept. A member who holds custody of an asset or kit cannot be deleted. This cannot be undone.`,
    };
  };

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      arrayFieldId="nrmIds"
      actionUrl="/api/nrm/bulk-actions"
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
