/**
 * @file Archive Audit Dialog
 *
 * Renders a confirmation dialog for archiving a completed audit session.
 * Used by the actions dropdown on the audit detail page when the audit
 * status is COMPLETED. Submits the "archive-audit" intent via POST to
 * the audit detail route action handler.
 *
 * @see {@link file://./actions-dropdown.tsx} - Triggers this dialog
 * @see {@link file://../../routes/_layout+/audits.$auditId.tsx} - Action handler
 */
import { useEffect, useRef } from "react";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { Form } from "../custom-form";

type ArchiveAuditDialogProps = {
  auditName: string;
  open: boolean;
  onClose: () => void;
  actionData?: DataOrErrorResponse;
};

/**
 * Confirmation dialog for archiving a completed audit.
 * Submits the "archive-audit" intent to the audit detail route action.
 */
export function ArchiveAuditDialog({
  auditName,
  open,
  onClose,
  actionData,
}: ArchiveAuditDialogProps) {
  const disabled = useDisabled();

  /** Stabilize onClose in a ref to avoid stale closures in the effect */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (actionData && "success" in actionData) {
      onCloseRef.current();
    }
  }, [actionData]);

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {auditName}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive this audit? Archived audits are
            hidden from the default list view but can still be found using the
            status filter. This action cannot be undone.
            {actionData && "error" in actionData && actionData.error && (
              <span className="mt-2 block text-sm text-error-500">
                {actionData.error.message}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="intent" value="archive-audit" />
              <Button type="submit" disabled={disabled}>
                Archive
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
