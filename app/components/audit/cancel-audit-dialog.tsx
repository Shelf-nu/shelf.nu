import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { AlertIcon } from "../icons/library";

type CancelAuditDialogProps = {
  auditName: string;
};

export function CancelAuditDialog({ auditName }: CancelAuditDialogProps) {
  const disabled = useDisabled();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
          width="full"
        >
          <span className="flex items-center gap-2">Cancel audit</span>
        </Button>
      </AlertDialogTrigger>

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
