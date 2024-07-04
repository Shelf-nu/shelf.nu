import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkReleaseKitCustodySchema = z.object({
  kitIds: z.array(z.string()).min(1),
});

export default function BulkReleaseCustodyDialog() {
  const zo = useZorm("BulkReleaseKitCustody", BulkReleaseKitCustodySchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="release-custody"
      title="Release custody over kits"
      description="Are you sure you want to release custody of all selected kits?"
      actionUrl="/api/kits/bulk-actions"
      arrayFieldId="kitIds"
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <div className="modal-content-wrapper">
          <input type="hidden" value="bulk-release-custody" name="intent" />

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
