import { useBulkModal } from "./bulk-update-modal";
import { Button } from "../shared/button";

export const useBulkCategoryUpdateModal = ({
  onClick,
}: {
  onClick: () => void;
}) => {
  const {
    BulkUpdateTrigger: BulkCategoryUpdateTrigger,
    BulkUpdateModal: BulkCategoryUpdateModal,
    disabled,
    handleCloseDialog,
  } = useBulkModal({
    key: "category",
    modalContent: <BulkCategoryUpdateModalContent />,
    onClick,
  });

  function BulkCategoryUpdateModalContent() {
    return (
      <>
        <div className=" relative z-50 mb-8">
          {/* @TODO - this is causing an endless re-render. Seems to be something in the hook useModelFilters */}
          {/* <CategorySelect isBulk /> */}
        </div>

        <div className="flex gap-3">
          <Button
            to=".."
            variant="secondary"
            width="full"
            disabled={disabled}
            onClick={handleCloseDialog}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            width="full"
            type="submit"
            disabled={disabled}
            name="intent"
            value="bulk-update-category"
          >
            Confirm
          </Button>
        </div>
      </>
    );
  }

  return [BulkCategoryUpdateTrigger, BulkCategoryUpdateModal];
};
