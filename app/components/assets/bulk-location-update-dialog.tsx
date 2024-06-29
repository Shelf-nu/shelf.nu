import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { LocationSelect } from "../location/location-select";
import { Button } from "../shared/button";

export const BulkLocationUpdateSchema = z.object({
  assetIds: z.array(z.string()),
  newLocationId: z
    .string({ required_error: "Location is required!" })
    .min(1, "Location is required!"),
});

export default function BulkLocationUpdateDialog() {
  const zo = useZorm("BulkLocationUpdate", BulkLocationUpdateSchema);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  return (
    <BulkUpdateDialogContent ref={zo.ref} type="location">
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <>
          {selectedAssets.map((assetId, i) => (
            <input
              key={assetId}
              type="hidden"
              name={`assetIds[${i}]`}
              value={assetId}
            />
          ))}
          <div className="modal-content-wrapper">
            <div className="relative z-50 mb-8">
              <LocationSelect isBulk />
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
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
