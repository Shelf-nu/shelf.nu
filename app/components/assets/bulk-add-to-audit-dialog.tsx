import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import useApiQuery from "~/hooks/use-api-query";
import { isSelectingAllItems } from "~/utils/list";
import AuditSelector from "../audit/audit-selector";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import type { IndexResponse } from "../list";
import { Button } from "../shared/button";

export const BulkAddToAuditSchema = z.object({
  assetIds: z.string().array().min(1),
  auditId: z.string().min(1, "Please select an audit"),
});

type PendingAudit = {
  id: string;
  name: string;
  createdAt: Date;
  expectedAssetCount: number;
  createdBy: {
    firstName: string | null;
    lastName: string | null;
  };
  assignments: Array<{
    user: {
      firstName: string | null;
      lastName: string | null;
    };
  }>;
};

export default function BulkAddToAuditDialog() {
  const zo = useZorm("BulkAddToAudit", BulkAddToAuditSchema);

  const { totalItems } = useLoaderData<IndexResponse>();
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const selectedCount = useAtomValue(selectedBulkItemsCountAtom);
  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);

  const isOpen = bulkDialogOpenState["add-to-audit"] === true;

  // Show totalItems when "Select All" is used, otherwise show selected count
  const allSelected = isSelectingAllItems(selectedItems);
  const displayCount = allSelected ? totalItems : selectedCount;

  const { data, isLoading, error } = useApiQuery<{
    audits: PendingAudit[];
  }>({
    api: "/api/audits/get-pending",
    enabled: isOpen,
  });

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="add-to-audit"
      title="Add assets to existing audit"
      description={`Add ${displayCount} asset${
        displayCount === 1 ? "" : "s"
      } to a pending audit. Select an audit below.`}
      actionUrl="/api/audits/add-assets"
      arrayFieldId="assetIds"
      skipCloseOnSuccess={true}
    >
      {({ fetcherError, fetcherData, disabled, handleCloseDialog }) => {
        const isSuccess = fetcherData?.success;
        const selectedAuditId = fetcherData?.auditId;

        return (
          <div className="modal-content-wrapper">
            {isSuccess ? (
              // Success state
              <>
                <div className="mb-6 rounded-md border border-success-200 bg-success-50 p-4">
                  <p className="text-sm font-medium text-success-900">
                    Successfully added {fetcherData.addedCount} asset
                    {fetcherData.addedCount === 1 ? "" : "s"} to the audit!
                  </p>
                  {fetcherData.skippedCount > 0 && (
                    <p className="mt-2 text-sm text-success-700">
                      {fetcherData.skippedCount} asset
                      {fetcherData.skippedCount === 1 ? " was" : "s were"}{" "}
                      already in the audit and skipped.
                    </p>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    width="full"
                    onClick={handleCloseDialog}
                  >
                    Close
                  </Button>
                  {selectedAuditId && (
                    <Button
                      variant="primary"
                      width="full"
                      to={`/audits/${selectedAuditId}/overview`}
                      onClick={handleCloseDialog}
                    >
                      View audit
                    </Button>
                  )}
                </div>
              </>
            ) : !isLoading && data?.audits?.length === 0 ? (
              // Empty state - no pending audits
              <>
                <div className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-600">
                    There are no pending audits.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    width="full"
                    onClick={handleCloseDialog}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    width="full"
                    to="/audits/new"
                    onClick={handleCloseDialog}
                  >
                    Create new audit
                  </Button>
                </div>
              </>
            ) : (
              // Form state
              <>
                <div className="relative z-50 mb-8">
                  <AuditSelector
                    name={zo.fields.auditId()}
                    audits={data?.audits || []}
                    placeholder={isLoading ? "Loading..." : "Select an audit"}
                    isLoading={isLoading}
                    error={
                      zo.errors.auditId()?.message || error || fetcherError
                    }
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    width="full"
                    disabled={disabled}
                    onClick={handleCloseDialog}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" width="full" disabled={disabled}>
                    {disabled ? "Adding..." : "Add to audit"}
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      }}
    </BulkUpdateDialogContent>
  );
}
