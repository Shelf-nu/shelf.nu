/**
 * Bulk "Set min quantity" dialog.
 *
 * Sets `Asset.minQuantity` across a selection. This is the cure for the state
 * the Stock status column spends most of its time reporting: measured on a live
 * workspace, 10 of 12 quantity assets had no reorder point, so the column reads
 * blank and says, correctly, that we have no opinion. Without a bulk way to fix
 * that, the column diagnoses a problem the product cannot treat.
 *
 * Clearing is supported by submitting an empty field, undoing a threshold you
 * set by mistake should not require editing assets one at a time either.
 *
 * @see {@link file://../../modules/asset/service.server.ts} - `bulkUpdateAssetMinQuantity`
 * @see {@link file://../../routes/api+/assets.bulk-set-reorder-point.ts}
 */

import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import Input from "../forms/input";
import { Button } from "../shared/button";

/**
 * An empty string clears the threshold; anything else must be a whole number of
 * zero or more. Zero is deliberately valid, it is a real "warn me when nothing
 * is left" threshold, and the shared `isLowStock` predicate treats only `null`
 * as "no threshold set".
 */
export const BulkSetReorderPointSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  minQuantity: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => value === "" || /^\d+$/.test(value),
      "Enter a whole number, or leave empty to clear the min quantity"
    )
    .transform((value) => (value === "" ? null : Number(value))),
});

export default function BulkSetReorderPointDialog() {
  const zo = useZorm("BulkSetReorderPoint", BulkSetReorderPointSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="reorder-point"
      arrayFieldId="assetIds"
      title="Set min quantity"
      description="Stock status shows “Running low” once available units fall to or below this number. Leave empty to clear it. Individually-tracked assets in your selection are skipped."
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <Input
              type="number"
              min={0}
              step={1}
              label="Min quantity"
              name={zo.fields.minQuantity()}
              disabled={disabled}
              className="w-full"
              placeholder="e.g. 5"
              error={zo.errors.minQuantity()?.message}
            />
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
              type="button"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              type="submit"
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
