import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkMarkAvailabilitySchema = z.object({
  assetIds: z.string().array().min(1),
  type: z.enum(["available", "unavailable"]),
});

export default function BulkMarkAvailabilityDialog({
  type,
}: {
  type: z.infer<typeof BulkMarkAvailabilitySchema>["type"];
}) {
  const zo = useZorm("BulkMarkAvailability", BulkMarkAvailabilitySchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type={type}
      title={`Mark assets as ${type}`}
      description={`Mark all selected assets as ${type}. Assets that are already ${type}, will be skipped.`}
      actionUrl="/api/assets/bulk-mark-availability"
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
