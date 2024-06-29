import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkCategoryUpdateSchema = z.object({
  assetIds: z.array(z.string()),
  category: z.string(),
});

export default function BulkCategoryUpdateDialog() {
  const zo = useZorm("BulkCategoryUpdate", BulkCategoryUpdateSchema);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  return (
    <BulkUpdateDialogContent ref={zo.ref} type="category">
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
          <div className="relative z-50 mb-8">
            <DynamicSelect
              disabled={disabled}
              model={{ name: "category", queryKey: "name" }}
              label="Filter by category"
              placeholder="Search categories"
              initialDataKey="categories"
              countKey="totalCategories"
              fieldName="category"
              contentLabel="Categories"
              closeOnSelect
            />
            {zo.errors.category()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.category()?.message}
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
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
