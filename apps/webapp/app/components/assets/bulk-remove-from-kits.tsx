import { useZorm } from "react-zorm";
import z from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkRemoveFromKitsSchema = z.object({
  assetIds: z.string().array().min(1),
});

export default function BulkRemoveFromKits() {
  const zo = useZorm("BulkRemoveFromKits", BulkRemoveFromKitsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="remove-from-kit"
      title="Remove assets from kits"
      description="This action will remove the selected assets from their kits. Are you sure you want to remove them?"
      actionUrl="/api/assets/bulk-remove-from-kits"
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
