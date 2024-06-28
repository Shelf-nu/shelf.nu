import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useAtomValue } from "jotai";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { LocationMarkerIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

type Key = "location" | "category";

const iconsMap: Record<Key, React.ReactNode | null> = {
  location: <LocationMarkerIcon />,
  category: null,
};

export const useBulkModal = ({
  key,
  modalContent,
  onClick,
}: {
  key: Key;
  modalContent: React.ReactNode;
  onClick: () => void;
}) => {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  function BulkUpdateTrigger() {
    return (
      <Button
        variant="link"
        className={tw(
          "justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
        )}
        width="full"
        onClick={() => {
          onClick();
          handleOpenDialog();
        }}
      >
        <span className="flex items-center gap-2">
          <Icon icon={key} /> Update {key}
        </span>
      </Button>
    );
  }

  function BulkUpdateModal() {
    // @TODO - here the form needs some validations and error rendering based on what is returned from the fetcher.data
    const selectedAssets = useAtomValue(selectedBulkItemsAtom);
    const itemsSelected = useAtomValue(selectedBulkItemsCountAtom);

    return (
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleCloseDialog}
          className="lg:w-[400px]"
          title={
            <div className="w-full">
              <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
                {iconsMap[key]}
              </div>
              <div className="mb-5">
                <h4>Update {key}</h4>
                <p>
                  Adjust the {key} of selected ({itemsSelected}) assets.
                </p>
              </div>
            </div>
          }
        >
          <fetcher.Form
            method="post"
            action={`/assets/bulk-update-${key}`}
            className="p-6 "
          >
            {selectedAssets.map((assetId, i) => (
              <input
                key={assetId}
                type="hidden"
                name={`assetIds[${i}]`}
                value={assetId}
              />
            ))}
            <div className="modal-content-wrapper">{modalContent}</div>
          </fetcher.Form>
        </Dialog>
      </DialogPortal>
    );
  }

  return {
    BulkUpdateTrigger,
    BulkUpdateModal,
    disabled,
    handleOpenDialog,
    handleCloseDialog,
  };
};
