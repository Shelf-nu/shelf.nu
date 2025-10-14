import { useEffect, useState } from "react";
import type { CustomField } from "@prisma/client";
import { useFetcher } from "@remix-run/react";
import Input from "~/components/forms/input";
import { TrashIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { DropdownMenuItem } from "~/components/shared/dropdown";
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
import type { action as deleteAction } from "~/routes/_layout+/settings.custom-fields";
import { isFormProcessing } from "~/utils/form";

export function DeleteCustomFieldDialog({
  customField,
}: {
  customField: CustomField;
}) {
  const fetcher = useFetcher<typeof deleteAction>();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const disabled = isFormProcessing(fetcher.state);
  const expectedName = customField.name;
  const confirmationMatches =
    confirmation.trim().toLowerCase() === expectedName.toLowerCase();

  const resetDialog = () => {
    setFormError(null);
    setConfirmation("");
  };

  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.error) {
      setFormError(fetcher.data.error.message);
      return;
    }

    // Don't reset here - onOpenChange will handle it when dialog closes
    setOpen(false);
  }, [fetcher.data]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled && nextOpen) return;
        if (!nextOpen) {
          resetDialog();
        }
        setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <DropdownMenuItem
          className="cursor-pointer rounded px-4 py-3 text-left text-sm hover:bg-gray-50"
          onSelect={(e) => {
            e.preventDefault();
          }}
        >
          <span className="flex items-center gap-2">
            <TrashIcon /> Delete
          </span>
        </DropdownMenuItem>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <fetcher.Form method="DELETE" action="/settings/custom-fields">
          <input type="hidden" name="id" value={customField.id} />
          <AlertDialogHeader>
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600 md:mx-0">
              <TrashIcon />
            </div>
            <AlertDialogTitle>
              Delete "{customField.name}" custom field
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                <strong>This field will be deleted.</strong> The field and all
                its values will be removed from your assets.
              </p>
              <p className="text-gray-700">
                💡 <strong>Note:</strong> The field name will be available for
                reuse after deleting.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-600">
              To confirm, type the custom field name below (case-insensitive).
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

          <AlertDialogFooter className="mt-6 flex ">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              disabled={disabled || !confirmationMatches}
              name="intent"
              value="delete"
            >
              {disabled ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
