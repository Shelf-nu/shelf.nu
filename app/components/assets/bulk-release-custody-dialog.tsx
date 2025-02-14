import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkReleaseCustodySchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

export default function BulkReleaseCustodyDialog() {
  const zo = useZorm("BulkReleaseCustody", BulkReleaseCustodySchema);

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
          {fetcherError ? (
            <p className="mb-2 text-sm text-error-500">{fetcherError}</p>
          ) : null}

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
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
