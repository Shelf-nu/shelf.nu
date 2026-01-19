import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import { useLoaderData, useNavigate } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import AuditTeamMemberSelector from "~/components/audit/audit-team-member-selector";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import Input from "~/components/forms/input";
import type { IndexResponse } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { useDisabled } from "~/hooks/use-disabled";
import { BaseAuditSchema } from "~/routes/api+/audits.start";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { isSelectingAllItems } from "~/utils/list";

/**
 * Schema for bulk audit creation from asset index.
 * Extends the base audit schema with required assetIds array.
 */
export const BulkStartAuditSchema = BaseAuditSchema.extend({
  assetIds: z.array(z.string()).min(1),
}).refine(
  (data) => {
    if (!data.dueDate) return true;
    const parsed = DateTime.fromFormat(data.dueDate, DATE_TIME_FORMAT);
    return parsed.isValid && parsed > DateTime.now();
  },
  {
    message: "Due date must be in the future",
    path: ["dueDate"],
  }
);

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
  dueDateField: string;
  nameError?: string;
  descriptionError?: string;
  dueDateError?: string;
  assigneeError?: string;
};

function StartAuditDialogContent({
  disabled,
  handleCloseDialog,
  fetcherError,
  fetcherData,
  nameField,
  descriptionField,
  dueDateField,
  nameError,
  descriptionError,
  dueDateError,
  assigneeError,
}: StartAuditDialogContentProps) {
  const navigate = useNavigate();
  const isNavigating = useDisabled();
  const formDisabled = disabled || isNavigating;

  useEffect(() => {
    if (!fetcherData?.success || !fetcherData.redirectTo) {
      return;
    }

    void navigate(fetcherData.redirectTo);
  }, [fetcherData, navigate]);

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
            disabled={formDisabled}
            className="mb-4"
          />

          <Input
            name={descriptionField}
            label="Description"
            placeholder="Add context that will help auditors (optional)."
            inputType="textarea"
            rows={5}
            error={fetcherError || descriptionError}
            disabled={formDisabled}
          />

          <Input
            name={dueDateField}
            label="Due date"
            type="datetime-local"
            error={dueDateError}
            disabled={formDisabled}
            className="mt-4"
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
          disabled={formDisabled}
          onClick={handleCloseDialog}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={formDisabled}>
          Start audit
        </Button>
      </div>
    </>
  );
}

export default function BulkStartAuditDialog() {
  const { totalItems } = useLoaderData<IndexResponse>();
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const selectedCount = useAtomValue(selectedBulkItemsCountAtom);

  // Show totalItems when "Select All" is used, otherwise show selected count
  const allSelected = isSelectingAllItems(selectedItems);
  const displayCount = allSelected ? totalItems : selectedCount;

  const zo = useZorm("BulkStartAudit", BulkStartAuditSchema);

  const nameField = zo.fields.name();
  const descriptionField = zo.fields.description();
  const dueDateField = zo.fields.dueDate();
  const nameError = zo.errors.name()?.message;
  const descriptionError = zo.errors.description()?.message;
  const dueDateError = zo.errors.dueDate()?.message;
  const assigneeError = zo.errors.assignee()?.message;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="start-audit"
      className="md:w-[800px]"
      title="Start an audit"
      description={`You're about to start an audit for ${displayCount} asset${
        displayCount === 1 ? "" : "s"
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
          dueDateField={dueDateField}
          nameError={nameError}
          descriptionError={descriptionError}
          dueDateError={dueDateError}
          assigneeError={assigneeError}
        />
      )}
    </BulkUpdateDialogContent>
  );
}
