import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useQrScanner } from "~/hooks/use-qr-scanner";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { ArrowRightIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";
import { ZXingScanner } from "../zxing-scanner/zxing-scanner";

type RelinkQrCodeDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function RelinkQrCodeDialog({
  open,
  onClose,
}: RelinkQrCodeDialogProps) {
  const { asset } = useLoaderData<typeof loader>();
  const { videoMediaDevices } = useQrScanner();

  const [newQrCode, setNewQrCode] = useState<string>();

  const qrCode = asset.qrCodes[0];

  function handleQrDetectionSuccess(qrId: string) {
    setNewQrCode(qrId);
  }

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={onClose}
        title={
          <div>
            <h3>Change QR Code</h3>
            <p className="text-gray-600">{asset.title}</p>
          </div>
        }
      >
        {videoMediaDevices && videoMediaDevices.length > 0 ? (
          <ZXingScanner
            className="max-h-[1000px]"
            overlayClassName="md:h-[320px] max-w-xs"
            isLoading={false}
            videoMediaDevices={videoMediaDevices}
            onQrDetectionSuccess={handleQrDetectionSuccess}
            allowNonShelfCodes
            hideBackButtonText
          />
        ) : (
          <div className="mt-4 flex h-full flex-col items-center justify-center">
            <Spinner /> Waiting for permission to access camera.
          </div>
        )}

        <div className="flex items-center justify-center gap-4 border-b border-gray-200 p-4">
          <div className="text-right">
            <p className="uppercase text-gray-500">Current code</p>
            <p className="font-medium">
              {qrCode ? qrCode.id : "Not linked yet"}
            </p>
          </div>
          <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5">
            <ArrowRightIcon />
          </div>
          <div>
            <p className="uppercase text-gray-500">New code</p>
            <p className="font-medium">
              {newQrCode ? newQrCode : "Scan a QR code to link..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 p-4">
          <Button
            className="flex-1"
            variant="secondary"
            disabled={!newQrCode}
            onClick={() => {
              setNewQrCode(undefined);
            }}
          >
            Rescan
          </Button>
          <Button className="flex-1" disabled={!newQrCode}>
            Link
          </Button>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
