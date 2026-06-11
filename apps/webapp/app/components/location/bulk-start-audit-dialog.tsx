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

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useAtomValue } from "jotai";
import { InfoIcon } from "lucide-react";
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
import type { ListItemData } from "~/components/list/list-item";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
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
 * Confirms the scope of the audit inside the dialog: how many locations are
 * selected and (for an explicit selection) their names and per-location asset
 * counts behind a "View list" popover.
 *
 * Two modes, driven by `allSelected`:
 * - **Select all** — we only hold the sentinel client-side, not the names, so
 *   we show the total count plus the active name search (if any). No list.
 * - **Explicit selection** — we have each row's `name`, so we show the count
 *   with a "View list" popover. The popover scrolls, so it scales from a
 *   handful of locations to 100+ without stretching the dialog.
 *
 * @param props.allSelected - Whether "select all" (filtered set) is active
 * @param props.count - Locations the audit will cover (total when `allSelected`)
 * @param props.locations - Selected rows; only read when `!allSelected`
 * @param props.search - Active Locations-list name search (`s`), for select-all copy
 * @returns A one-line scope summary, with a names popover for explicit selections
 */
function SelectedLocationsSummary({
  allSelected,
  count,
  locations,
  search,
}: {
  allSelected: boolean;
  count: number;
  locations: ListItemData[];
  search: string | null;
}) {
  const plural = count === 1 ? "" : "s";

  if (allSelected) {
    return (
      <p className="text-sm text-gray-700">
        Auditing assets in{" "}
        <span className="font-medium">
          all {count} location{plural}
        </span>
        {search ? (
          <>
            {" "}
            matching <span className="font-medium">“{search}”</span>
          </>
        ) : null}
        .
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
      <span>
        Auditing assets in{" "}
        <span className="font-medium">
          {count} location{plural}
        </span>
        .
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm font-medium"
          >
            View list
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className="z-[999999] mt-2 max-h-[300px] w-[260px] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-md"
          >
            <p className="border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-500">
              Selected locations ({count})
            </p>
            <ul className="py-1">
              {locations.map((location) => {
                // Row data carried from the Locations list (see its loader's
                // `_count` select). Default to 0 if a row somehow lacks it.
                const assetCount: number = location._count?.assets ?? 0;
                return (
                  <li
                    key={location.id}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                  >
                    <span
                      className="truncate text-gray-700"
                      title={location.name ?? undefined}
                    >
                      {location.name || "Untitled location"}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">
                      {assetCount} asset{assetCount === 1 ? "" : "s"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}

/**
 * Renders the "Create audit" dialog wired to the Locations index multi-select.
 * The audit covers the union of all assets in the selected locations.
 */
export default function LocationsBulkStartAuditDialog() {
  const { totalItems } = useLoaderData<IndexResponse>();
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const selectedCount = useAtomValue(selectedBulkItemsCountAtom);
  const [searchParams] = useSearchParams();

  // Show totalItems when "Select All" is used, otherwise the selected count
  const allSelected = isSelectingAllItems(selectedItems);
  const displayCount = allSelected ? totalItems : selectedCount;
  // Active name search on the Locations list — only meaningful for "select all",
  // where it tells the user which filtered set the audit will cover.
  const search = searchParams.get("s")?.trim() || null;

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
      description="Set up an audit for the assets in the locations you selected."
      actionUrl="/api/audits/start"
      arrayFieldId="locationIds"
      formClassName="px-0"
    >
      {({ disabled, handleCloseDialog, fetcherError, fetcherData }) => (
        <>
          {/* Routes the request to the location branch of /api/audits/start */}
          <input type="hidden" name="contextType" value="location" />
          <div className="space-y-3 border-t px-6 py-3">
            {/* Confirm what's selected so the user can verify scope before submit */}
            <SelectedLocationsSummary
              allSelected={allSelected}
              count={displayCount}
              locations={selectedItems}
              search={search}
            />
            {/* Set expectations: the audit covers assets directly assigned to the
                selected locations only — assets in their sub-locations are not
                pulled in (the resolver does not walk the location tree here). */}
            <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-gray-400" />
              <p>
                The audit will include every asset directly assigned to the
                selected location{displayCount === 1 ? "" : "s"}. Assets in
                sub-locations aren&apos;t included.
              </p>
            </div>
          </div>
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
