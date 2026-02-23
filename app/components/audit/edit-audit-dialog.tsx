import { useEffect, useMemo } from "react";
import type { AuditStatus } from "@prisma/client";
import { AlertTriangleIcon } from "lucide-react";
import { Form } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import AuditTeamMemberSelector from "~/components/audit/audit-team-member-selector";
import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import When from "~/components/when/when";
import { useDisabled } from "~/hooks/use-disabled";
import { dateForDateTimeInputValue } from "~/utils/date-fns";

export const EditAuditSchema = z.object({
  name: z.string().trim().min(1, "Audit name is required"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional(),
  dueDate: z.string().optional(),
  assignee: z.string().optional(),
});

type EditAuditDialogProps = {
  audit: {
    id: string;
    name: string;
    description: string | null;
    dueDate: Date | null;
    status: AuditStatus;
    assignments: Array<{
      userId: string;
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
      };
    }>;
  };
  teamMembers: Array<{
    id: string;
    name: string;
    userId: string | null;
  }>;
  open: boolean;
  onClose: () => void;
  actionData?: any;
};

export function EditAuditDialog({
  audit,
  teamMembers,
  open,
  onClose,
  actionData,
}: EditAuditDialogProps) {
  const disabled = useDisabled();
  const zo = useZorm("EditAudit", EditAuditSchema);

  const nameField = zo.fields.name();
  const descriptionField = zo.fields.description();
  const dueDateField = zo.fields.dueDate();
  const nameError = zo.errors.name()?.message;
  const descriptionError = zo.errors.description()?.message;
  const dueDateError = zo.errors.dueDate()?.message;
  const assigneeError = zo.errors.assignee()?.message;

  // Format due date for datetime-local input using standard utility
  const defaultDueDate = useMemo(() => {
    if (!audit.dueDate) return undefined;
    return dateForDateTimeInputValue(new Date(audit.dueDate)).substring(0, 16);
  }, [audit.dueDate]);

  // Get current assignee's team member ID (convert from user ID)
  const defaultAssigneeTeamMemberId = useMemo(() => {
    if (audit.assignments.length === 0) {
      return undefined;
    }
    const currentUserId = audit.assignments[0].userId;
    const teamMember = teamMembers.find((tm) => tm.userId === currentUserId);
    return teamMember?.id;
  }, [teamMembers, audit.assignments]);

  const isActiveAudit = audit.status === "ACTIVE";

  // Close dialog on success
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
              Update the name, description, due date, and assignee of this
              audit.
            </p>
          </div>
        }
        headerClassName="border-b"
        className="md:w-[800px] [&_.dialog-header>button]:mt-1"
      >
        <Form ref={zo.ref} method="post">
          <input type="hidden" name="intent" value="edit-audit" />

          <div className="grid grid-cols-1 border-t px-6 pb-4 md:grid-cols-2 md:divide-x">
            {/* Left column: Basic fields */}
            <div className="py-4 pr-6">
              <Input
                name={nameField}
                label="Audit name"
                placeholder="Quarterly warehouse audit"
                defaultValue={audit.name}
                error={nameError || actionData?.error}
                required
                disabled={disabled}
                className="mb-4"
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
                className="mb-4"
              />

              <Input
                name={dueDateField}
                label="Due date"
                type="datetime-local"
                defaultValue={defaultDueDate}
                error={dueDateError}
                disabled={disabled}
              />

              <When truthy={isActiveAudit}>
                <div className="mt-4 flex gap-3 rounded border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangleIcon className="size-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-amber-900">
                      Active audit
                    </p>
                    <p className="mt-1 text-sm text-amber-700">
                      This audit is currently active. Changing the assignee may
                      affect ongoing scans.
                    </p>
                  </div>
                </div>
              </When>
            </div>

            {/* Right column: Team member selector */}
            <div className="!border-r">
              <Separator className="md:hidden" />
              <p className="p-3 pb-0 font-medium">Select assignee (optional)</p>
              <p className="border-b p-3">
                If no assignee is selected, any admin user can perform the
                audit. This can also be done by multiple users at different
                times.
              </p>
              <AuditTeamMemberSelector
                error={assigneeError}
                defaultValue={defaultAssigneeTeamMemberId}
              />
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 border-t p-4 md:col-span-2">
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
      </Dialog>
    </DialogPortal>
  );
}
