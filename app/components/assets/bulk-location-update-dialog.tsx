import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { LocationSelect } from "../location/location-select";
import { Button } from "../shared/button";

export const BulkLocationUpdateSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  newLocationId: z
    .string({ required_error: "Location is required!" })
    .min(1, "Location is required!"),
});

export default function BulkLocationUpdateDialog() {
  const zo = useZorm("BulkLocationUpdate", BulkLocationUpdateSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="location"
      arrayFieldId="assetIds"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div>
          <div className="relative z-50 mb-8">
            <LocationSelect isBulk hideClearButton />
            {zo.errors.newLocationId()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.newLocationId()?.message}
              </p>
            ) : null}
            {fetcherError ? (
              <p className="text-sm text-error-500">{fetcherError}</p>
            ) : null}
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
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
