import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import {
  StartAuditDialogContent,
  type StartAuditFetcherData,
} from "~/components/audit/start-audit-dialog-content";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import type { IndexResponse } from "~/components/list";
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
