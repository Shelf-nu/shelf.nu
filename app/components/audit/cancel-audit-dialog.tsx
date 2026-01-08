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
import { Form } from "../custom-form";
import { AlertIcon } from "../icons/library";

type CancelAuditDialogProps = {
  auditName: string;
  open: boolean;
  onClose: () => void;
};

export function CancelAuditDialog({
  auditName,
  open,
  onClose,
}: CancelAuditDialogProps) {
  const disabled = useDisabled();

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
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Close
              </Button>
            </AlertDialogCancel>

            <Form method="post">
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
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
