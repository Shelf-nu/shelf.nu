import { useEffect } from "react";
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
import { Form } from "../custom-form";

type ArchiveAuditDialogProps = {
  auditName: string;
  open: boolean;
  onClose: () => void;
  actionData?: any;
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

  useEffect(() => {
    if (actionData?.success) {
      onClose();
    }
  }, [actionData, onClose]);

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {auditName}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive this audit? Archived audits are
            hidden from the default list view but can still be found using the
            status filter. This action cannot be undone.
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
