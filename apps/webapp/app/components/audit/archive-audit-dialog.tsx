/**
 * @file Archive Audit Dialog
 *
 * Renders a confirmation dialog for archiving a completed audit session.
 * Used by the actions dropdown on the audit detail page when the audit
 * status is COMPLETED. Submits the "archive-audit" intent via a scoped
 * fetcher to avoid cross-form interference with other dialogs on the page.
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

type ArchiveAuditDialogProps = {
  auditName: string;
  open: boolean;
  onClose: () => void;
};

/**
 * Confirmation dialog for archiving a completed audit.
 * Uses a fetcher so its response is scoped and doesn't
 * interfere with other forms on the audit detail page.
 */
export function ArchiveAuditDialog({
  auditName,
  open,
  onClose,
}: ArchiveAuditDialogProps) {
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);

  /** Stabilize onClose in a ref to avoid stale closures in the effect */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data) {
      onCloseRef.current();
    }
  }, [fetcher.data]);

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {auditName}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive this audit? Archived audits are
            hidden from the default list view but can still be found using the
            status filter. This action cannot be undone.
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
                Cancel
              </Button>
            </AlertDialogCancel>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="archive-audit" />
              <Button type="submit" disabled={disabled}>
                Archive
              </Button>
            </fetcher.Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
