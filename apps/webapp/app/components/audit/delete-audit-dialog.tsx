/**
 * @file Delete Audit Dialog
 *
 * Confirmation dialog for permanently deleting an archived audit session.
 * Requires the user to type the audit name before the Delete button becomes
 * enabled, through the shared {@link TypeToConfirm} field every permanent
 * delete uses. The server repeats the check with the same rule.
 *
 * The "archive-first" contract is enforced at the service and route layer;
 * this dialog is only rendered by the actions dropdown when the audit is in
 * `ARCHIVED` status. On successful deletion the server redirects to
 * `/audits`, so the dialog never needs to self-close on success.
 *
 * @see {@link file://./actions-dropdown.tsx} - Triggers this dialog
 * @see {@link file://../../routes/_layout+/audits.$auditId.tsx} - Action handler
 * @see {@link file://../shared/type-to-confirm.tsx} - Shared field
 */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { TrashIcon } from "~/components/icons/library";
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
import {
  TypeToConfirm,
  useTypeToConfirm,
} from "~/components/shared/type-to-confirm";
import { useDisabled } from "~/hooks/use-disabled";

/** Props for the {@link DeleteAuditDialog} component. */
type DeleteAuditDialogProps = {
  /** Display name of the audit being deleted — also the expected confirmation input. */
  auditName: string;
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Callback invoked when the dialog should close. */
  onClose: () => void;
};

/**
 * Destructive confirmation dialog for deleting an archived audit.
 *
 * Disables the Delete button until the user types the audit name (the
 * shared rule: case-insensitive, trimmed). Submission uses a scoped fetcher so the
 * server response does not collide with other forms on the audit detail
 * page. On success the server redirects — no client close required.
 */
export function DeleteAuditDialog({
  auditName,
  open,
  onClose,
}: DeleteAuditDialogProps) {
  const fetcher = useFetcher({ key: "delete-audit" });
  const disabled = useDisabled(fetcher);
  const confirm = useTypeToConfirm(auditName);
  const { reset } = confirm;

  // Reset the input whenever the dialog closes so the next open starts fresh
  // (users shouldn't see their previous attempt lingering in the field).
  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const fetcherError =
    fetcher.data && "error" in fetcher.data && fetcher.data.error
      ? fetcher.data.error.message
      : null;

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600 md:mx-0">
            <TrashIcon />
          </div>
          <AlertDialogTitle>Delete "{auditName}"</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this audit and all its data (scans,
            notes, and images). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form method="post" className="mt-4 space-y-2">
          <input type="hidden" name="intent" value="delete-audit" />

          <TypeToConfirm
            expected={auditName}
            value={confirm.value}
            onChange={confirm.setValue}
            disabled={disabled}
          />
          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <AlertDialogFooter className="mt-6 flex">
            <div className="flex justify-center gap-2">
              <AlertDialogCancel asChild>
                <Button type="button" variant="secondary" disabled={disabled}>
                  Cancel
                </Button>
              </AlertDialogCancel>
              <Button
                className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                type="submit"
                disabled={disabled || !confirm.isConfirmed}
              >
                {disabled ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
