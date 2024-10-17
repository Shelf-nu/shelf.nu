import { useCallback, useEffect, useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useQrScanner } from "~/hooks/use-qr-scanner";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { isFormProcessing } from "~/utils/form";
import Icon from "../icons/icon";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";
import When from "../when/when";
import { ZXingScanner } from "../zxing-scanner/zxing-scanner";

type RelinkQrCodeDialogProps = {
  open: boolean;
  onClose: () => void;
};

type CurrentState = "initial" | "qr-selected";

export default function RelinkQrCodeDialog({
  open,
  onClose,
}: RelinkQrCodeDialogProps) {
  const { asset } = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    success: boolean;
    error?: { message: string };
  }>();
  const { videoMediaDevices } = useQrScanner();

  const [currentState, setCurrentState] = useState<CurrentState>("initial");
  const [newQrId, setNewQrId] = useState<string>();

  const navigation = useNavigation();
  const isSubmitting = isFormProcessing(navigation.state);

  const qrCode = asset.qrCodes[0];

  function handleQrDetectionSuccess(qrId: string) {
    setNewQrId(qrId);
  }

  const handleClose = useCallback(() => {
    setNewQrId(undefined);
    setCurrentState("initial");
    onClose();
  }, [onClose]);

  useEffect(
    function closeOnSuccess() {
      if (!actionData?.error && actionData?.success === true) {
        handleClose();
      }
    },
    [actionData, handleClose]
  );

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleClose}
        title={
          <>
            <When truthy={currentState === "initial"}>
              <div>
                <h3>Change QR Code</h3>
                <p className="text-gray-600">{asset.title}</p>
              </div>
            </When>
            <When truthy={currentState === "qr-selected"}>
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-4 shadow-lg">
                <Icon icon="change" />
              </div>
            </When>
          </>
        }
      >
        <When truthy={currentState === "initial"}>
          <>
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
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5 shadow-lg">
                <ArrowRightIcon />
              </div>
              <div>
                <p className="uppercase text-gray-500">New code</p>
                <p className="font-medium">
                  {newQrId ? newQrId : "Scan a QR code to link..."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4">
              <Button
                className="flex-1"
                variant="secondary"
                disabled={!newQrId}
                onClick={() => {
                  setNewQrId(undefined);
                }}
              >
                Rescan
              </Button>
              <Button
                className="flex-1"
                disabled={!newQrId}
                onClick={() => {
                  setCurrentState("qr-selected");
                }}
              >
                Link
              </Button>
            </div>
          </>
        </When>
        <When truthy={currentState === "qr-selected"}>
          <div className="p-6">
            <div className="mb-5">
              <h3>Change QR code</h3>
              <p>
                Are you sure you want to relink the code for{" "}
                <span className="font-bold">{asset.title}</span>? The current
                code will become unlinked.
              </p>
            </div>

            <div className="mb-1 flex items-center gap-2.5 rounded border border-gray-200 p-2">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5">
                <ArrowLeftIcon />
              </div>
              <div>
                <p className="uppercase text-gray-600">Current code</p>
                <p className="font-medium">{qrCode ? qrCode.id : "N/A"}</p>
              </div>
            </div>
            <div className="mb-8 flex items-center gap-2.5 rounded border border-gray-200 p-2">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5">
                <ArrowRightIcon />
              </div>
              <div>
                <p className="uppercase text-gray-600">New code</p>
                <p className="font-medium">{newQrId}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                className="flex-1"
                variant="secondary"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Form method="post" className="flex-1">
                <input type="hidden" value={newQrId} name="newQrId" />
                <input type="hidden" value="relink-qr-code" name="intent" />

                <Button
                  className="w-full"
                  type="submit"
                  disabled={isSubmitting}
                >
                  Confirm
                </Button>
              </Form>
            </div>
          </div>
        </When>

        {actionData?.error ? (
          <p className="p-6 text-error-500">{actionData.error.message}</p>
        ) : null}
      </Dialog>
    </DialogPortal>
  );
}
