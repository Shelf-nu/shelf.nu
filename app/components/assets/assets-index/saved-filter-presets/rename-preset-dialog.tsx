import { type ChangeEvent } from "react";
import { Form } from "react-router";
import { useZorm } from "react-zorm";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { RenamePresetFormSchema } from "~/modules/asset-filter-presets/schemas";

/**
 * Dialog for renaming an existing saved filter preset.
 *
 * @param open - Whether the dialog is open
 * @param onOpenChange - Callback when dialog open state changes
 * @param presetId - ID of the preset being renamed
 * @param name - Controlled input value for new preset name
 * @param onNameChange - Handler for preset name input changes
 * @param isSubmitting - Whether form is currently submitting
 * @param validationErrors - Server-side validation errors
 */
export function RenamePresetDialog({
  open,
  onOpenChange,
  presetId,
  name,
  onNameChange,
  isSubmitting,
  validationErrors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetId: string;
  name: string;
  onNameChange: (e: ChangeEvent<HTMLInputElement>) => void;
  isSubmitting: boolean;
  validationErrors?: Partial<Record<"name", { message: string | undefined }>>;
}) {
  const zo = useZorm("rename-preset", RenamePresetFormSchema);

  // Combine client-side and server-side validation errors
  const nameError =
    validationErrors?.name?.message ?? zo.errors.name()?.message;

  return (
    <DialogPortal>
      <Dialog
        wrapperClassName="!z-[9999]"
        open={open}
        onClose={() => onOpenChange(false)}
        title={
          <div className="-mb-3 w-full pb-6">
            <h3>Rename filter preset</h3>
            <p className="text-gray-500">
              Update the name of your saved filter preset.
            </p>
          </div>
        }
      >
        <div className="px-6 pb-5">
          <Form method="post" ref={zo.ref}>
            <input type="hidden" name="intent" value="rename-preset" />
            <input type="hidden" name="presetId" value={presetId} />
            <Input
              label="New name"
              name="name"
              value={name}
              onChange={onNameChange}
              placeholder="Enter new name"
              maxLength={60}
              autoFocus
              error={nameError}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || isSubmitting}>
                {isSubmitting ? "Renaming..." : "Rename"}
              </Button>
            </div>
          </Form>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
