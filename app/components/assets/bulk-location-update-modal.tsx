import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import {
  bulkLocationUpdateDialogOpenAtom,
  closeBulkUpdateLocationDialogAtom,
  openBulkUpdateLocationDialogAtom,
} from "~/atoms/location";
import { type action } from "~/routes/api+/assets.bulk-update-location";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { LocationMarkerIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { LocationSelect } from "../location/location-select";
import { Button } from "../shared/button";

export const BulkLocationUpdateSchema = z.object({
  assetIds: z.array(z.string()),
  newLocationId: z
    .string({ required_error: "Location is required!" })
    .min(1, "Location is required!"),
});

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
  const fetcher = useFetcher<typeof action>();
  const disabled = isFormProcessing(fetcher.state);

  const zo = useZorm("BulkLocationUpdate", BulkLocationUpdateSchema);

  const [selectedAssets, setSelectedAssets] = useAtom(selectedBulkItemsAtom);
  const itemsSelected = useAtomValue(selectedBulkItemsCountAtom);

  const closeDialog = useSetAtom(closeBulkUpdateLocationDialogAtom);
  const isDialogOpen = useAtomValue(bulkLocationUpdateDialogOpenAtom);

  useEffect(
    function handleOnSuccess() {
      if (fetcher.data?.error) {
        return;
      }

      /** We have to close the dialog and remove all selected assets when update is success */
      if (fetcher.data?.success) {
        closeDialog();
        setSelectedAssets([]);
      }
    },
    [closeDialog, fetcher.data, setSelectedAssets]
  );

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
          action="/api/assets/bulk-update-location"
          className="px-6 pb-6"
          ref={zo.ref}
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
            <div className="relative z-50 mb-8">
              <LocationSelect isBulk />
              {zo.errors.newLocationId()?.message ? (
                <p className="text-sm text-error-500">
                  {zo.errors.newLocationId()?.message}
                </p>
              ) : null}
              {fetcher?.data?.error ? (
                <p className="text-sm text-error-500">
                  {fetcher.data.error.message}
                </p>
              ) : null}
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
              <Button variant="primary" width="full" disabled={disabled}>
                Confirm
              </Button>
            </div>
          </div>
        </fetcher.Form>
      </Dialog>
    </DialogPortal>
  );
}
