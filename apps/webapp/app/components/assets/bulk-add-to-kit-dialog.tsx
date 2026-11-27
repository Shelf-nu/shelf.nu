import type { Kit } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import z from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import useApiQuery from "~/hooks/use-api-query";
import { MAX_LIST_ITEMS } from "~/utils/zod";
import { QuantityTrackedSkipWarning } from "./quantity-tracked-skip-warning";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import KitSelector from "../kits/kit-selector";
import { Button } from "../shared/button";

export const BulkAddToKitSchema = z.object({
  assetIds: z.string().array().max(MAX_LIST_ITEMS).min(1),
  kit: z.string().min(1),
});

export default function BulkAddToKitDialog() {
  const zo = useZorm("BulkAddToKit", BulkAddToKitSchema);

  const selectedAssets = useAtomValue(selectedBulkItemsCountAtom);
  // why: bulk add-to-kit can't carry a per-asset quantity input, so qty-tracked
  // assets in the selection are skipped server-side (same as
  // `bulkUpdateAssetLocation`). The warning rendered from these rows says so
  // before the user confirms.
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);

  const isOpen = bulkDialogOpenState["add-to-kit"] === true;

  const { data, isLoading, error } = useApiQuery<{
    kits: Array<Pick<Kit, "id" | "name">>;
  }>({
    api: "/api/assets/bulk-add-to-kit",
    enabled: isOpen,
  });

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="add-to-kit"
      title="Add assets to a kit"
      description={`${selectedAssets} asset${
        selectedAssets > 1 ? "s" : ""
      } will be added to the kit. Please select a kit to add the assets to`}
      actionUrl="/api/assets/bulk-add-to-kit"
      arrayFieldId="assetIds"
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <div className="modal-content-wrapper">
          <QuantityTrackedSkipWarning
            selectedItems={selectedItems}
            instead="Quantity-tracked assets must be added to a kit individually with a specific quantity from the kit's manage-assets page."
          />
          <div className="relative z-50 mb-8">
            <KitSelector
              name={zo.fields.kit()}
              kits={data?.kits || []}
              placeholder={isLoading ? "Loading..." : "Select a kit"}
              isLoading={isLoading}
              error={zo.errors.kit()?.message || error || fetcherError}
            />
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
