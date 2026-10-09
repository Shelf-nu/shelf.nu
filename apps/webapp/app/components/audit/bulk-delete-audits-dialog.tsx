/**
 * @file Bulk Delete Audits Dialog
 *
 * Confirmation dialog for permanently deleting multiple archived audit
 * sessions from the audits index page. The user types the number of selected
 * audits before Delete is enabled, the same typed-count rule every bulk delete
 * follows; the server checks the number too (`assertBulkDeleteConfirmed`).
 *
 * Only applicable to audits in `ARCHIVED` status. The surrounding
 * {@link AuditIndexBulkActionsDropdown} disables the trigger when any
 * selected audit is not archived; the service layer also re-checks.
 *
 * @see {@link file://../../routes/api+/audits.bulk-actions.ts} - Action handler
 * @see {@link file://./audit-index-bulk-actions-dropdown.tsx} - Triggers this dialog
 * @see {@link file://../bulk-update-dialog/bulk-delete-confirmation.tsx} - Shared body
 */
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AuditsIndexLoaderData } from "~/routes/_layout+/audits._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkDeleteConfirmation } from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

/**
 * Zod schema for the bulk delete form. The typed count is validated by the
 * service, which knows how many audits the selection resolves to.
 */
export const BulkDeleteAuditsSchema = z.object({
  auditIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
});

/**
 * Bulk delete confirmation dialog. Mirrors the visual shape of
 * {@link BulkArchiveAuditsDialog} and adds the shared typed-count field so a
 * destructive submission is always a deliberate act.
 */
export default function BulkDeleteAuditsDialog() {
  const { totalItems } = useLoaderData<AuditsIndexLoaderData>();
  const selectedAudits = useAtomValue(selectedBulkItemsAtom);
  const totalSelected = isSelectingAllItems(selectedAudits)
    ? totalItems
    : selectedAudits.length;
  const noun = totalSelected === 1 ? "audit" : "audits";

  const zo = useZorm("BulkDeleteAudits", BulkDeleteAuditsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="delete-audit"
      arrayFieldId="auditIds"
      actionUrl="/api/audits/bulk-actions"
      title={`Delete ${totalSelected} ${noun}`}
      description={`This permanently deletes ${totalSelected} archived ${noun} with all their scans, notes and images. This cannot be undone.`}
    >
      {({
        disabled,
        fetcherError,
        fetcherErrorAdditionalData,
        handleCloseDialog,
      }) => (
        <>
          <input type="hidden" name="intent" value="bulk-delete" />
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
