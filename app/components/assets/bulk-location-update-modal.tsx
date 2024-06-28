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

export const useBulkLocationUpdateModal = ({
  onClick,
}: {
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

  function BulkLocationUpdateTrigger() {
    return (
      <Button
        // role="link"
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
          <Icon icon="location" /> Update location
        </span>
      </Button>
    );
  }

  function BulkLocationUpdateModal() {
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
            <div>
              <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
                <LocationMarkerIcon />
              </div>
              <div className="mb-5">
                <h4>Update location</h4>
                <p>Adjust the location of {itemsSelected} assets.</p>
              </div>
            </div>
          }
        >
          <fetcher.Form
            method="post"
            action="/assets/bulk-update-location"
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
            <div className="modal-content-wrapper">
              <div className=" relative z-50 mb-8">
                {/* <LocationSelect /> */}
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
                  value="bulk-update-location"
                >
                  Confirm
                </Button>
              </div>
            </div>
          </fetcher.Form>
        </Dialog>
      </DialogPortal>
    );
  }

  return [BulkLocationUpdateTrigger, BulkLocationUpdateModal];
};
