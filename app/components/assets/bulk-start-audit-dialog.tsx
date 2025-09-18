import { useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";

import { selectedBulkItemsCountAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

export const BulkStartAuditSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  name: z.string().trim().min(1, "Audit name is required"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional(),
  assigneeIds: z.array(z.string()).optional(),
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
}: StartAuditDialogContentProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!fetcherData?.success || !fetcherData.redirectTo) {
      return;
    }

    handleCloseDialog();
    navigate(fetcherData.redirectTo);
  }, [fetcherData, handleCloseDialog, navigate]);

  return (
    <div className="modal-content-wrapper">
      <div className="flex flex-col gap-4">
        <Input
          name={nameField}
          label="Audit name"
          placeholder="Quarterly warehouse audit"
          error={nameError}
          required
          disabled={disabled}
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

      <div className="mt-6 flex gap-3">
        <Button
          type="button"
          variant="secondary"
          width="full"
          disabled={disabled}
          onClick={handleCloseDialog}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          width="full"
          disabled={disabled}
        >
          Start audit
        </Button>
      </div>
    </div>
  );
}

export default function BulkStartAuditDialog() {
  const selectedCount = useAtomValue(selectedBulkItemsCountAtom);
  const zo = useZorm("BulkStartAudit", BulkStartAuditSchema);

  const nameField = zo.fields.name();
  const descriptionField = zo.fields.description();
  const nameError = zo.errors.name()?.message;
  const descriptionError = zo.errors.description()?.message;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="start-audit"
      title="Start an audit"
      description={`You're about to start an audit for ${selectedCount} asset${
        selectedCount === 1 ? "" : "s"
      }.`}
      actionUrl="/api/audits/start"
      arrayFieldId="assetIds"
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
        />
      )}
    </BulkUpdateDialogContent>
  );
}
