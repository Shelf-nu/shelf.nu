/**
 * @file Bulk Delete Audits Dialog
 *
 * Confirmation dialog for permanently deleting multiple archived audit
 * sessions from the audits index page. Requires the user to type the
 * literal string "DELETE" before submission is enabled — a cheaper
 * confirmation than per-audit name matching, which would be unusable at
 * scale (Toby runs ~125 audits/month).
 *
 * Only applicable to audits in `ARCHIVED` status. The surrounding
 * {@link AuditIndexBulkActionsDropdown} disables the trigger when any
 * selected audit is not archived; the service layer also re-checks.
 *
 * @see {@link file://../../routes/api+/audits.bulk-actions.ts} - Action handler
 * @see {@link file://./audit-index-bulk-actions-dropdown.tsx} - Triggers this dialog
 */
import { useState } from "react";
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { AuditsIndexLoaderData } from "~/routes/_layout+/audits._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import Input from "../forms/input";
import { Button } from "../shared/button";

/**
 * Zod schema for the bulk delete form. The literal "DELETE" confirmation is
 * validated server-side as well — never trust the client-side gate alone.
 */
export const BulkDeleteAuditsSchema = z.object({
  auditIds: z.array(z.string()).min(1),
  confirmation: z.literal("DELETE", {
    errorMap: () => ({ message: "Type DELETE to confirm." }),
  }),
});

/** The literal word users must type to unlock the destructive action. */
const CONFIRMATION_WORD = "DELETE";

/**
 * Bulk delete confirmation dialog. Mirrors the visual shape of
 * {@link BulkArchiveAuditsDialog} but adds a hard-to-hit confirmation
 * input so destructive submission is always a deliberate act.
 */
export default function BulkDeleteAuditsDialog() {
  const { totalItems } = useLoaderData<AuditsIndexLoaderData>();
  const selectedAudits = useAtomValue(selectedBulkItemsAtom);
  const totalSelected = isSelectingAllItems(selectedAudits)
    ? totalItems
    : selectedAudits.length;

  const [confirmation, setConfirmation] = useState("");
  const confirmationMatches = confirmation === CONFIRMATION_WORD;

  const zo = useZorm("BulkDeleteAudits", BulkDeleteAuditsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="delete-audit"
      arrayFieldId="auditIds"
      actionUrl="/api/audits/bulk-actions"
      title={`Delete ${totalSelected} audits`}
      description={`Permanently delete ${totalSelected} archived audits? This will remove all scan data, notes, and images. This action cannot be undone.`}
    >
      {({ disabled, fetcherError, handleCloseDialog }) => (
        <>
          <input type="hidden" name="intent" value="bulk-delete" />

          <div className="mt-2 space-y-2">
            <p className="text-sm text-gray-600">
              To confirm, type{" "}
              <span className="font-semibold">{CONFIRMATION_WORD}</span> below.
            </p>
            <Input
              label="Confirmation"
              name={zo.fields.confirmation()}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              required
              error={zo.errors.confirmation()?.message}
            />
          </div>

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="mt-4 flex gap-3">
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
              disabled={disabled || !confirmationMatches}
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
            >
              Delete
            </Button>
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
