import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { useNavigate } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import { selectedBulkItemsCountAtom } from "~/atoms/list";
import AuditTeamMemberSelector from "~/components/audit/audit-team-member-selector";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";

export const BulkStartAuditSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  name: z.string().trim().min(1, "Audit name is required"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional(),
  assignee: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      try {
        const parsed = JSON.parse(val);
        return parsed.userId;
      } catch {
        return val;
      }
    }),
});

type StartAuditFetcherData = {
  success?: boolean;
  redirectTo?: string;
};

type StartAuditDialogContentProps = {
  disabled: boolean;
  handleCloseDialog: () => void;
  fetcherError?: string;
  fetcherData?: StartAuditFetcherData;
  nameField: string;
  descriptionField: string;
  nameError?: string;
  descriptionError?: string;
  assigneeError?: string;
};

function StartAuditDialogContent({
  disabled,
  handleCloseDialog,
  fetcherError,
  fetcherData,
  nameField,
  descriptionField,
  nameError,
  descriptionError,
  assigneeError,
}: StartAuditDialogContentProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!fetcherData?.success || !fetcherData.redirectTo) {
      return;
    }

    handleCloseDialog();
    void navigate(fetcherData.redirectTo);
  }, [fetcherData, handleCloseDialog, navigate]);

  return (
    <>
      <div className="grid grid-cols-1 border-t px-6 pb-4 md:grid-cols-2 md:divide-x">
        {/* Left column: Form fields */}
        <div className="py-4 pr-6">
          <Input
            name={nameField}
            label="Audit name"
            placeholder="Quarterly warehouse audit"
            error={nameError}
            required
            disabled={disabled}
            className="mb-4"
          />

          <Input
            name={descriptionField}
            label="Description"
            placeholder="Add context that will help auditors (optional)."
            inputType="textarea"
            rows={5}
            error={fetcherError || descriptionError}
            disabled={disabled}
          />
        </div>

        {/* Right column: Team member selector */}
        <div className="!border-r">
          <Separator className="md:hidden" />
          <p className="border-b p-3 font-medium">Select assignee (optional)</p>
          <AuditTeamMemberSelector error={assigneeError} />
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-2 border-t p-4 pb-0 md:col-span-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={handleCloseDialog}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={disabled}>
          Start audit
        </Button>
      </div>
    </>
  );
}

export default function BulkStartAuditDialog() {
  const selectedCount = useAtomValue(selectedBulkItemsCountAtom);
  const zo = useZorm("BulkStartAudit", BulkStartAuditSchema);

  const nameField = zo.fields.name();
  const descriptionField = zo.fields.description();
  const nameError = zo.errors.name()?.message;
  const descriptionError = zo.errors.description()?.message;
  const assigneeError = zo.errors.assignee()?.message;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="start-audit"
      className="md:w-[800px]"
      title="Start an audit"
      description={`You're about to start an audit for ${selectedCount} asset${
        selectedCount === 1 ? "" : "s"
      }.`}
      actionUrl="/api/audits/start"
      arrayFieldId="assetIds"
      formClassName="px-0"
    >
      {({ disabled, handleCloseDialog, fetcherError, fetcherData }) => (
        <StartAuditDialogContent
          disabled={disabled}
          handleCloseDialog={handleCloseDialog}
          fetcherError={fetcherError}
          fetcherData={fetcherData as StartAuditFetcherData}
          nameField={nameField}
          descriptionField={descriptionField}
          nameError={nameError}
          descriptionError={descriptionError}
          assigneeError={assigneeError}
        />
      )}
    </BulkUpdateDialogContent>
  );
}
