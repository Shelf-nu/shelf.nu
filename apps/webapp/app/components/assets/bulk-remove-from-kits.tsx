import { useZorm } from "react-zorm";
import z from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkRemoveFromKitsSchema = z.object({
  assetIds: z.string().array().min(1),
});

/**
 * why: no reserved-booking warning here, unlike the two kit-scoped removal
 * surfaces (`kits.$kitId.assets.manage-assets` and the kit row's Remove
 * dialog). This selection spans arbitrary kits — the operator never sees which
 * kits are involved, so "removes them from N reserved bookings" has no kit to
 * anchor it to; `BulkUpdateDialogContent` has no pre-submit data-loading hook
 * to fetch the impact with; and the query would be the broadest of the three
 * (every selected asset's memberships, plus the select-all path). Deferred.
 */
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
