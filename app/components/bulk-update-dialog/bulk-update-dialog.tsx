import { forwardRef } from "react";
import { useFetcher } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  bulkDialogAtom,
  closeBulkDialogAtom,
  openBulkDialogAtom,
} from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import type { action } from "~/routes/api+/assets.bulk-update-location";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { CategoriesIcon, LocationMarkerIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

/**
 * Type of the dialog
 * This `type` will be used to find which dialog to open while clicking on trigger
 * */
type BulkDialogType = "location" | "category";

const iconsMap: Record<BulkDialogType, React.ReactNode | null> = {
  location: <LocationMarkerIcon />,
  category: <CategoriesIcon />,
};

type CommonBulkDialogProps = {
  type: BulkDialogType;
};

type BulkUpdateDialogTriggerProps = CommonBulkDialogProps & {
  onClick?: () => void;
};

/** This component is going to trigger the open state of dialog */
function BulkUpdateDialogTrigger({
  type,
  onClick,
}: BulkUpdateDialogTriggerProps) {
  const openBulkDialog = useSetAtom(openBulkDialogAtom);

  function handleOpenDialog() {
    openBulkDialog(type);
  }

  return (
    <Button
      variant="link"
      className={tw(
        "justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
      )}
      width="full"
      onClick={() => {
        onClick && onClick();
        handleOpenDialog();
      }}
    >
      <span className="flex items-center gap-2">
        {iconsMap[type]} Update {type}
      </span>
    </Button>
  );
}

type DialogContentChildrenProps = {
  disabled: boolean;
  handleCloseDialog: () => void;
  fetcherError?: string;
};

type BulkUpdateDialogContentProps = CommonBulkDialogProps & {
  children:
    | React.ReactNode
    | ((props: DialogContentChildrenProps) => React.ReactNode);
};

/** This component is basically the body of the Dialog */
const BulkUpdateDialogContent = forwardRef<
  React.ElementRef<"form">,
  BulkUpdateDialogContentProps
>(function ({ type, children }, ref) {
  const fetcher = useFetcher<typeof action>();
  const disabled = isFormProcessing(fetcher.state);

  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);
  const closeBulkDialog = useSetAtom(closeBulkDialogAtom);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const itemsSelected = useAtomValue(selectedBulkItemsCountAtom);

  const isDialogOpen = bulkDialogOpenState[type] === true;

  function handleCloseDialog() {
    closeBulkDialog(type);
  }

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        className="lg:w-[400px]"
        title={
          <div className="w-full">
            <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
              {iconsMap[type]}
            </div>
            <div className="mb-5">
              <h4>Update {type}</h4>
              <p>
                Adjust the {type} of selected ({itemsSelected}) assets.
              </p>
            </div>
          </div>
        }
      >
        <fetcher.Form
          ref={ref}
          method="post"
          action={`/api/assets/bulk-update-${type}`}
          className="px-6 pb-6"
        >
          {selectedAssets.map((assetId, i) => (
            <input
              key={assetId}
              type="hidden"
              name={`assetIds[${i}]`}
              value={assetId}
            />
          ))}
          <div className="modal-content-wrapper">
            {typeof children === "function"
              ? children({
                  disabled,
                  handleCloseDialog,
                  fetcherError: fetcher?.data?.error?.message,
                })
              : children}
          </div>
        </fetcher.Form>
      </Dialog>
    </DialogPortal>
  );
});

BulkUpdateDialogContent.displayName = "BulkUpdateDialogContent";

export {
  BulkUpdateDialogTrigger,
  BulkUpdateDialogContent,
  type BulkDialogType,
};
