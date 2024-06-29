import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export default function BulkCategoryUpdateDialog() {
  return (
    <BulkUpdateDialogContent type="category">
      {({ disabled, handleCloseDialog }) => (
        <>
          <div className=" relative z-50 mb-8">
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
