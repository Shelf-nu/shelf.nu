/**
 * @file Cancel Audit Dialog
 *
 * Renders a confirmation dialog for cancelling an active audit session.
 * Used by the actions dropdown on the audit detail page when the current
 * user is the audit creator and the audit is not yet completed or cancelled.
 * Submits the "cancel-audit" intent via a scoped fetcher to avoid
 * cross-form interference with other dialogs on the page.
 *
 * @see {@link file://./actions-dropdown.tsx} - Triggers this dialog
 * @see {@link file://../../routes/_layout+/audits.$auditId.tsx} - Action handler
 */
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
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
import { tw } from "~/utils/tw";
import { AlertIcon } from "../icons/library";

/** Props for the {@link CancelAuditDialog} component. */
type CancelAuditDialogProps = {
  /** Display name of the audit being cancelled */
  auditName: string;
  /** Whether the dialog is currently visible */
  open: boolean;
  /** Callback invoked when the dialog should close */
  onClose: () => void;
};

/**
 * Confirmation dialog for cancelling an active audit.
 * Uses a fetcher so its response is scoped and doesn't
 * interfere with other forms on the audit detail page.
 */
export function CancelAuditDialog({
  auditName,
  open,
  onClose,
}: CancelAuditDialogProps) {
  const fetcher = useFetcher({ key: "cancel-audit" });
  const disabled = useDisabled(fetcher);

  /** Stabilize onClose in a ref to avoid stale closures in the effect */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "success" in fetcher.data) {
      onCloseRef.current();
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <AlertIcon />
            </span>
          </div>
          <AlertDialogTitle>Cancel {auditName}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel this audit? This action cannot be
            undone.
            {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
              <span className="mt-2 block text-sm text-error-500">
                {fetcher.data.error.message}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Close
              </Button>
            </AlertDialogCancel>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="cancel-audit" />
              <Button
                type="submit"
                className={tw(
                  "border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                )}
                disabled={disabled}
              >
                Cancel audit
              </Button>
            </fetcher.Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
