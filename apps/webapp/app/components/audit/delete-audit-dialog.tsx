import { useEffect, useState } from "react";
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
import { isFormProcessing } from "~/utils/form";
import Input from "../forms/input";

type DeleteAuditDialogProps = {
  auditId: string;
  auditName: string;
  open: boolean;
  onClose: () => void;
};

export function DeleteAuditDialog({
  auditId,
  auditName,
  open,
  onClose,
}: DeleteAuditDialogProps) {
  const fetcher = useFetcher();
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const disabled = isFormProcessing(fetcher.state);
  const expectedName = auditName;
  const confirmationMatches =
    confirmation.trim().toLowerCase() === expectedName.toLowerCase();

  const resetDialog = () => {
    setFormError(null);
    setConfirmation("");
  };

  useEffect(() => {
    if (!fetcher.data) return;
    const result = fetcher.data as {
      error?: { message?: string };
      success?: boolean;
    };
    if (result.error) {
      setFormError(result.error.message ?? "Failed to delete audit");
      return;
    }
    if (result.success) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled && nextOpen) return;
        if (!nextOpen) {
          resetDialog();
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete-audit" />
          <input type="hidden" name="auditId" value={auditId} />
          <AlertDialogHeader>
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600 md:mx-0">
              <TrashIcon />
            </div>
            <AlertDialogTitle>Delete &quot;{auditName}&quot;</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                <strong>
                  This will permanently delete this audit and all its data
                  (scans, notes, images). This action cannot be undone.
                </strong>
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-600">
              To confirm, type the audit name below.
            </p>
            <Input
              label="Confirmation"
              name="confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                if (formError) setFormError(null);
              }}
              required
            />
            <p className="text-sm text-gray-500">
              Expected input: {expectedName}
            </p>
            {formError ? (
              <p className="text-sm text-error-500">{formError}</p>
            ) : null}
          </div>

          <AlertDialogFooter className="mt-6 flex">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              disabled={disabled || !confirmationMatches}
            >
              {disabled ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
