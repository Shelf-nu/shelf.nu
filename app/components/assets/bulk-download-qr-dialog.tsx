import { useAtomValue } from "jotai";
import { DownloadIcon } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkDownloadQrSchema = z.object({
  assetIds: z.string().array().min(1),
});

export default function BulkDownloadQrDialog() {
  const zo = useZorm("BulkDownloadQr", BulkDownloadQrSchema);

  const assetsSelected = useAtomValue(selectedBulkItemsAtom);
  const isAllSelect = isSelectingAllItems(assetsSelected);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="download-qr"
      arrayFieldId="assetIds"
      title="Download QR codes"
      description={`Download QR codes for ${
        isAllSelect ? "all" : `${assetsSelected.length} assets(s)`
      }`}
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          {zo.errors.assetIds()?.message ? (
            <p className="text-sm text-error-500">
              {zo.errors.assetIds()?.message}
            </p>
          ) : null}

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
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
