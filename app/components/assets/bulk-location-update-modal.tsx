import { useFetcher } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import {
  bulkLocationUpdateDialogOpenAtom,
  closeBulkUpdateLocationDialogAtom,
  openBulkUpdateLocationDialogAtom,
} from "~/atoms/location";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { LocationMarkerIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { LocationSelect } from "../location/location-select";
import { Button } from "../shared/button";

export function BulkLocationUpdateTrigger({
  onClick,
}: {
  onClick: () => void;
}) {
  const openDialog = useSetAtom(openBulkUpdateLocationDialogAtom);

  return (
    <Button
      variant="link"
      className={tw(
        "justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
      )}
      width="full"
      onClick={() => {
        onClick();
        openDialog();
      }}
    >
      <span className="flex items-center gap-2">
        <Icon icon="location" /> Update location
      </span>
    </Button>
  );
}

export function BulkLocationUpdateDialog() {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);

  // @TODO - here the form needs some validations and error rendering based on what is returned from the fetcher.data
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const itemsSelected = useAtomValue(selectedBulkItemsCountAtom);

  const closeDialog = useSetAtom(closeBulkUpdateLocationDialogAtom);
  const isDialogOpen = useAtomValue(bulkLocationUpdateDialogOpenAtom);

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={closeDialog}
        className="lg:w-[400px]"
        title={
          <div className="w-full">
            <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
              <LocationMarkerIcon />
            </div>
            <div className="mb-5">
              <h4>Update location</h4>
              <p>Adjust the location of selected ({itemsSelected}) assets.</p>
            </div>
          </div>
        }
      >
        <fetcher.Form
          method="post"
          action="/assets/bulk-update-location"
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
            <div className=" relative z-50 mb-8">
              <LocationSelect isBulk />
            </div>

            <div className="flex gap-3">
              <Button
                to=".."
                variant="secondary"
                width="full"
                disabled={disabled}
                onClick={closeDialog}
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
