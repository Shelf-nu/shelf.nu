/**
 * Delete Custom Field Dialog
 *
 * Deletes one custom field from Settings > Custom fields. The user types the
 * field's name before Delete is enabled, through the shared
 * {@link TypeToConfirm} field; the route repeats the check with the same rule.
 *
 * The delete is soft: the field is marked deleted and renamed so its name can
 * be reused, and every asset's value for it stays stored but is never shown
 * again. The app has no way to bring the field or its values back.
 *
 * @see {@link file://../../routes/_layout+/settings.custom-fields.tsx} - Action handler
 * @see {@link file://../../modules/custom-field/service.server.ts} softDeleteCustomField
 */
import { useEffect, useState } from "react";
import type { CustomField } from "@prisma/client";
import { useFetcher } from "react-router";
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
import {
  TypeToConfirm,
  useTypeToConfirm,
} from "~/components/shared/type-to-confirm";
import type { action as deleteAction } from "~/routes/_layout+/settings.custom-fields";
import { isFormProcessing } from "~/utils/form";

export function DeleteCustomFieldDialog({
  customField,
}: {
  customField: CustomField;
}) {
  const fetcher = useFetcher<typeof deleteAction>();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const disabled = isFormProcessing(fetcher.state);
  const confirm = useTypeToConfirm(customField.name);

  const resetDialog = () => {
    setFormError(null);
    confirm.reset();
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
                <strong>This field will be deleted.</strong> It disappears from
                every asset, and its values are no longer shown anywhere. The
                app cannot bring the field or its values back.
              </p>
              <p>
                <strong>Note:</strong> The field name will be available for
                reuse after deleting.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-4 space-y-2">
            <TypeToConfirm
              expected={customField.name}
              value={confirm.value}
              onChange={(value) => {
                confirm.setValue(value);
                if (formError) setFormError(null);
              }}
              disabled={disabled}
            />
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
              disabled={disabled || !confirm.isConfirmed}
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
