import type { Kit } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import z from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsCountAtom } from "~/atoms/list";
import useApiQuery from "~/hooks/use-api-query";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import KitSelector from "../kits/kit-selector";
import { Button } from "../shared/button";

export const BulkAddToKitSchema = z.object({
  assetIds: z.string().array().min(1),
  kit: z.string().min(1),
});

export default function BulkAddToKitDialog() {
  const zo = useZorm("BulkAddToKit", BulkAddToKitSchema);

  const selectedAssets = useAtomValue(selectedBulkItemsCountAtom);
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
          <div className="relative z-50 mb-8">
            <KitSelector
              name={zo.fields.kit()}
              kits={data?.kits || []}
              placeholder={isLoading ? "Loading..." : "Select a kit"}
              isLoading={isLoading}
              error={zo.errors.kit()?.message || error || fetcherError}
            />
          </div>

          <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm text-blue-800">
              <strong>Location Update Notice:</strong> Adding assets to a kit
              will automatically update the asset locations to match the kit's
              location (if the kit has one).
            </p>
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
