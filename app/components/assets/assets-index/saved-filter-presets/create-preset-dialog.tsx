import { type ChangeEvent } from "react";
import { Form } from "react-router";
import { useZorm } from "react-zorm";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { CreatePresetFormSchema } from "~/modules/asset-filter-presets/schemas";
import type { getValidationErrors } from "~/utils/http";

/**
 * Dialog for creating a new saved filter preset.
 *
 * @param open - Whether the dialog is open
 * @param onOpenChange - Callback when dialog open state changes
 * @param query - Current URL query string to save
 * @param name - Controlled input value for preset name
 * @param onNameChange - Handler for preset name input changes
 * @param isSubmitting - Whether form is currently submitting
 * @param validationErrors - Server-side validation errors
 */
export function CreatePresetDialog({
  open,
  onOpenChange,
  query,
  name,
  onNameChange,
  isSubmitting,
  validationErrors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  name: string;
  onNameChange: (e: ChangeEvent<HTMLInputElement>) => void;
  isSubmitting: boolean;
  validationErrors?: ReturnType<
    typeof getValidationErrors<typeof CreatePresetFormSchema>
  >;
}) {
  const zo = useZorm("create-preset", CreatePresetFormSchema);

  // Combine client-side and server-side validation errors
  const nameError =
    validationErrors?.name?.message ?? zo.errors.name()?.message;

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Save filter preset"
    >
      <DialogPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <Form method="post" ref={zo.ref}>
              <input type="hidden" name="intent" value="create-preset" />
              <input type="hidden" name="query" value={query} />
              <Input
                label="Preset name"
                name="name"
                value={name}
                onChange={onNameChange}
                placeholder="e.g., Available laptops"
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
                  {isSubmitting ? "Saving..." : "Save"}
                </Button>
              </div>
            </Form>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
