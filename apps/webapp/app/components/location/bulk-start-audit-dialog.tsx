/**
 * Bulk "Create audit" dialog for the Locations index.
 *
 * Mirrors the assets bulk-audit dialog but operates on selected *locations*: the
 * shared dialog harness posts the selected location IDs as `locationIds[]` (plus
 * `currentSearchParams`, and the ALL_SELECTED_KEY sentinel on "select all"), and
 * a hidden `contextType=location` field routes the request to the location
 * branch of `/api/audits/start`, which resolves the union of assets server-side.
 *
 * @see {@link file://./../assets/bulk-start-audit-dialog.tsx} the assets counterpart
 * @see {@link file://./../../routes/api+/audits.start.ts} server-side resolution
 */

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
 * Client-side schema for the Locations bulk-audit dialog. The harness injects
 * the selected location IDs under `locationIds`, so require at least one.
 * Server-side validation lives in `StartAuditSchema` (`/api/audits/start`).
 */
export const LocationsBulkStartAuditSchema = BaseAuditSchema.extend({
  locationIds: z.array(z.string()).min(1),
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

/**
 * Renders the "Create audit" dialog wired to the Locations index multi-select.
 * The audit covers the union of all assets in the selected locations.
 */
export default function LocationsBulkStartAuditDialog() {
  const { totalItems } = useLoaderData<IndexResponse>();
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const selectedCount = useAtomValue(selectedBulkItemsCountAtom);

  // Show totalItems when "Select All" is used, otherwise the selected count
  const allSelected = isSelectingAllItems(selectedItems);
  const displayCount = allSelected ? totalItems : selectedCount;

  const zo = useZorm("LocationsBulkStartAudit", LocationsBulkStartAuditSchema);

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
      description={`You're about to start an audit covering the assets in ${displayCount} location${
        displayCount === 1 ? "" : "s"
      }.`}
      actionUrl="/api/audits/start"
      arrayFieldId="locationIds"
      formClassName="px-0"
    >
      {({ disabled, handleCloseDialog, fetcherError, fetcherData }) => (
        <>
          {/* Routes the request to the location branch of /api/audits/start */}
          <input type="hidden" name="contextType" value="location" />
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
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
