/**
 * @file Bulk Archive Audits Dialog
 *
 * Confirmation dialog for bulk-archiving audit sessions from the audits
 * index page. Only audits in a terminal state (COMPLETED or CANCELLED)
 * may be archived. Submits the "bulk-archive" intent to the
 * `/api/audits/bulk-actions` endpoint.
 *
 * @see {@link file://../../routes/api+/audits.bulk-actions.ts} - Action handler
 * @see {@link file://./audit-index-bulk-actions-dropdown.tsx} - Triggers this dialog
 */
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AuditsIndexLoaderData } from "~/routes/_layout+/audits._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

/** Zod schema for validating the bulk archive form submission. */
export const BulkArchiveAuditsSchema = z.object({
  auditIds: z.array(z.string()).min(1),
});

/**
 * Bulk archive confirmation dialog.
 * Shows the count of selected audits and submits a bulk-archive request.
 */
export default function BulkArchiveAuditsDialog() {
  const { totalItems } = useLoaderData<AuditsIndexLoaderData>();

  const auditsSelected = useAtomValue(selectedBulkItemsAtom);
  const totalSelected = isSelectingAllItems(auditsSelected)
    ? totalItems
    : auditsSelected.length;

  const zo = useZorm("BulkArchiveAudits", BulkArchiveAuditsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="archive"
      arrayFieldId="auditIds"
      actionUrl="/api/audits/bulk-actions"
      title={`Archive (${totalSelected}) audits`}
      description={`Are you sure you want to archive all (${totalSelected}) audits? Archived audits are hidden from the default list view but can still be found using the status filter. This action cannot be undone.`}
    >
      {({ disabled, fetcherError, handleCloseDialog }) => (
        <>
          <input type="hidden" value="bulk-archive" name="intent" />

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
