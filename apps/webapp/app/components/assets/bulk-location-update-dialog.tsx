import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { MAX_LIST_ITEMS, requiredError } from "~/utils/zod";
import { QuantityTrackedSkipWarning } from "./quantity-tracked-skip-warning";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { LocationSelect } from "../location/location-select";
import { Button } from "../shared/button";

export const BulkLocationUpdateSchema = z.object({
  assetIds: z.array(z.string()).max(MAX_LIST_ITEMS).optional().default([]),
  kitIds: z.array(z.string()).max(MAX_LIST_ITEMS).optional().default([]),
  newLocationId: z.string(requiredError("Please select a location")),
});

export default function BulkLocationUpdateDialog() {
  const zo = useZorm("BulkLocationUpdate", BulkLocationUpdateSchema);

  /**
   * Bulk location update has no per-asset qty input, so QUANTITY_TRACKED
   * assets are skipped server-side (`bulkUpdateAssetLocation` filters them
   * out, see `modules/asset/service.server.ts`). The warning below says so
   * before the user confirms, and the route's notification gives the real
   * count afterwards.
   */
  const selectedItems = useAtomValue(selectedBulkItemsAtom);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="location"
      arrayFieldId="assetIds"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div>
          <QuantityTrackedSkipWarning
            selectedItems={selectedItems}
            instead="Quantity-tracked assets must have their placements managed individually with a per-location quantity."
          />
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
