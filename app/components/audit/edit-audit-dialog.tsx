import { useEffect } from "react";
import { Form } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

export const EditAuditSchema = z.object({
  name: z.string().trim().min(1, "Audit name is required"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional(),
});

type EditAuditDialogProps = {
  audit: {
    id: string;
    name: string;
    description: string | null;
  };
  open: boolean;
  onClose: () => void;
  actionData?: any;
};

export function EditAuditDialog({
  audit,
  open,
  onClose,
  actionData,
}: EditAuditDialogProps) {
  const disabled = useDisabled();
  const zo = useZorm("EditAudit", EditAuditSchema);

  const nameField = zo.fields.name();
  const descriptionField = zo.fields.description();
  const nameError = zo.errors.name()?.message;
  const descriptionError = zo.errors.description()?.message;

  // Close dialog on success (redirect happens in action)
  useEffect(() => {
    if (actionData?.success) {
      onClose();
    }
  }, [actionData, onClose]);

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={onClose}
        title={
          <div className="-mb-3 w-full pb-6">
            <h3>Edit audit details</h3>
            <p className="text-gray-600">
              Update the name and description of this audit.
            </p>
          </div>
        }
        headerClassName="border-b"
        className="md:w-[650px] [&_.dialog-header>button]:mt-1"
      >
        <div className="px-6 py-4">
          <Form ref={zo.ref} method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="edit-audit" />

            <Input
              name={nameField}
              label="Audit name"
              placeholder="Quarterly warehouse audit"
              defaultValue={audit.name}
              error={nameError || actionData?.error}
              required
              disabled={disabled}
              data-dialog-initial-focus
            />

            <Input
              name={descriptionField}
              label="Description"
              placeholder="Add context that will help auditors (optional)."
              inputType="textarea"
              rows={5}
              defaultValue={audit.description || ""}
              error={descriptionError}
              disabled={disabled}
            />

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={disabled}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={disabled}>
                {disabled ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </Form>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
