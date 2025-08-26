import type { Kit } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import z from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsCountAtom } from "~/atoms/list";
import useApiQuery from "~/hooks/use-api-query";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
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
            <Select name={zo.fields.kit()}>
              <SelectTrigger>
                <SelectValue
                  placeholder={isLoading ? "Loading..." : "Select a kit"}
                />
              </SelectTrigger>

              <SelectContent className="p-1">
                {data?.kits?.map((kit) => (
                  <SelectItem
                    value={kit.id}
                    key={kit.id}
                    className="border-gray-200 px-4 py-3"
                  >
                    {kit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {zo.errors.kit()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.kit()?.message}
              </p>
            ) : null}

            {error ? <p className="text-sm text-error-500">{error}</p> : null}

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
