import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { isQuantityTracked } from "~/modules/asset/utils";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import { WarningBox } from "../shared/warning-box";

export const BulkReleaseCustodySchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

export default function BulkReleaseCustodyDialog() {
  const zo = useZorm("BulkReleaseCustody", BulkReleaseCustodySchema);

  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const quantityTrackedCount = selectedItems.filter((item) =>
    isQuantityTracked(item)
  ).length;

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="release-custody"
      title="Release custody of assets"
      description="Are you sure you want to release custody of all selected assets?"
      actionUrl="/api/assets/bulk-release-custody"
      arrayFieldId="assetIds"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          {quantityTrackedCount > 0 ? (
            <div className="mb-4">
              <WarningBox>
                <span>
                  {quantityTrackedCount} quantity-tracked asset(s) in your
                  selection will be skipped. Quantity-tracked assets must have
                  custody released individually.
                </span>
              </WarningBox>
            </div>
          ) : null}
          {fetcherError ? (
            <p className="mb-2 text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex gap-3">
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
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
