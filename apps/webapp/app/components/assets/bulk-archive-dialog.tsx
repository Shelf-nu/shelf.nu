/**
 * Bulk Archive / Reinstate Dialog
 *
 * Confirmation dialog for archiving or reinstating the selected assets in one
 * action. Mirrors the bulk mark-availability dialog: a single component
 * parameterised by `type` ("archive" | "reinstate"), posting to the dedicated
 * `/api/assets/bulk-archive` route. Ineligible assets (checked out, in custody,
 * quantity-tracked, or already in the target state) are skipped server-side and
 * reported back in the success notification. See issue #382.
 *
 * @see {@link file://./../../routes/api+/assets.bulk-archive.ts}
 * @see {@link file://./bulk-mark-availability-dialog.tsx}
 */

import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkArchiveSchema = z.object({
  assetIds: z.string().array().min(1),
  type: z.enum(["archive", "reinstate"]),
});

/**
 * Renders the bulk archive/reinstate confirmation dialog.
 *
 * @param props.type - "archive" to archive the selection, "reinstate" to restore it.
 */
export default function BulkArchiveDialog({
  type,
}: {
  type: z.infer<typeof BulkArchiveSchema>["type"];
}) {
  const zo = useZorm("BulkArchive", BulkArchiveSchema);
  const isArchive = type === "archive";

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type={type}
      title={isArchive ? "Archive assets" : "Reinstate assets"}
      description={
        isArchive
          ? "Archive all selected assets. They will be hidden from your lists and can't be booked or assigned custody. Assets that are checked out, in custody, quantity-tracked, or already archived are skipped. You can reinstate them at any time."
          : "Reinstate all selected assets. They will be active and bookable again. Assets that aren't archived are skipped."
      }
      actionUrl="/api/assets/bulk-archive"
      arrayFieldId="assetIds"
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <div className="modal-content-wrapper">
          <input type="hidden" name="type" value={type} />

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
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
