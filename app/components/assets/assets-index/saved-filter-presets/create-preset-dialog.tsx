import { type ChangeEvent } from "react";
import { Form } from "react-router";
import { useZorm } from "react-zorm";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { useFilterPreview } from "~/hooks/use-filter-preview";
import { CreatePresetFormSchema } from "~/modules/asset-filter-presets/schemas";
import type { Column } from "~/modules/asset-index-settings/helpers";
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
  columns,
  name,
  onNameChange,
  isSubmitting,
  validationErrors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  columns: Column[];
  name: string;
  onNameChange: (e: ChangeEvent<HTMLInputElement>) => void;
  isSubmitting: boolean;
  validationErrors?: ReturnType<
    typeof getValidationErrors<typeof CreatePresetFormSchema>
  >;
}) {
  const zo = useZorm("create-preset", CreatePresetFormSchema);

  // Get formatted preview component from hook
  const { preview } = useFilterPreview({ query, columns });

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
            <h3>Save filter preset</h3>
            <p className="text-gray-500">
              Give your filter a name and save it for quick access later.
            </p>
          </div>
        }
      >
        <div className="px-6 pb-5">
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

            {/* Filter preview */}
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="mb-1 text-xs font-medium text-gray-600">Preview</p>
              {preview}
            </div>

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
      </Dialog>
    </DialogPortal>
  );
}
