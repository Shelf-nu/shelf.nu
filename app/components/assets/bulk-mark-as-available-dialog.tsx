import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkMarkAsAvailableSchema = z.object({
  assetIds: z.string().array().min(1),
});

export default function BulkMarkAsAvailableDialog() {
  const zo = useZorm("BulkMarkAsAvailable", BulkMarkAsAvailableSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="available"
      title="Mark assets as available"
      description="Mark all selected assets as available. Assets that are already available, will be skipped."
      actionUrl="/api/assets/bulk-mark-as-available"
      arrayFieldId="assetIds"
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <div className="modal-content-wrapper">
          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
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
