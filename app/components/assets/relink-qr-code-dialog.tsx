import { useCallback, useEffect, useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useVideoDevices } from "~/hooks/use-video-devices";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { isFormProcessing } from "~/utils/form";
import Icon from "../icons/icon";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import When from "../when/when";
import { WasmScanner } from "../zxing-scanner/wasm-scanner";

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
  const { devices, DevicesPermissionComponent } = useVideoDevices();

  const [currentState, setCurrentState] = useState<CurrentState>("initial");
  const [newQrId, setNewQrId] = useState<string>();
  const [errorMessage, setErrorMessage] = useState("");

  const navigation = useNavigation();
  const isSubmitting = isFormProcessing(navigation.state);

  const qrCode = asset.qrCodes[0];
  const isNewCodeSameAsCurrent = qrCode?.id === newQrId;

  function handleQrDetectionSuccess(qrId: string, error?: string) {
    /** Set the error returned from the scanner */
    if (error && error !== "") {
      setErrorMessage(error);
    }

    /** Update the qrId */
    setNewQrId(qrId);

    /** If the scanned code is the same code, set an error */
    if (qrCode?.id === qrId) {
      setErrorMessage(
        "The new code you scanned is the same as the current code of the asset. Please scan a different code."
      );
    }
  }

  const handleClose = useCallback(() => {
    setNewQrId(undefined);
    setCurrentState("initial");
    setErrorMessage("");
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

  useEffect(
    function showActionError() {
      if (actionData?.error) {
        setErrorMessage(actionData.error.message);
      }
    },
    [actionData?.error]
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
        className="[&_.dialog-body]:flex [&_.dialog-body]:flex-col"
      >
        <When truthy={currentState === "initial"}>
          <>
            {devices ? (
              <WasmScanner
                className="h-auto flex-1"
                overlayClassName="md:h-[320px] max-w-xs"
                isLoading={false}
                devices={devices}
                onQrDetectionSuccess={handleQrDetectionSuccess}
                allowNonShelfCodes
                hideBackButtonText
                paused={!!newQrId}
                setPaused={() => {}}
              />
            ) : (
              <DevicesPermissionComponent />
            )}

            <div className="flex items-center justify-center gap-4 border-b border-gray-200 p-4">
              <div className="flex-1 truncate text-right">
                <p className="uppercase text-gray-500">Current code</p>
                <p
                  className="truncate font-medium"
                  title={qrCode ? qrCode.id : "Not linked yet"}
                >
                  {qrCode ? qrCode.id : "Not linked yet"}
                </p>
              </div>
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5 shadow-lg">
                <ArrowRightIcon />
              </div>
              <div className="flex-1 truncate">
                <p className="uppercase text-gray-500">New code</p>
                <p
                  className="truncate font-medium"
                  title={newQrId ? newQrId : "Scan a QR code to link..."}
                >
                  {newQrId ? newQrId : "Scan a QR code to link..."}
                </p>
              </div>
            </div>

            <When truthy={!!errorMessage}>
              <p className="mt-4 px-8 text-center text-sm text-error-500">
                {errorMessage}
              </p>
            </When>

            <div className="flex items-center gap-4 p-4">
              <Button
                className="flex-1"
                variant="secondary"
                disabled={!newQrId}
                onClick={() => {
                  setNewQrId(undefined);
                  setErrorMessage("");
                }}
              >
                Rescan
              </Button>
              <Button
                className="flex-1"
                disabled={!newQrId || isNewCodeSameAsCurrent || !!errorMessage}
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
            <div className="flex items-center gap-2.5 rounded border border-gray-200 p-2">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5">
                <ArrowRightIcon />
              </div>
              <div>
                <p className="uppercase text-gray-600">New code</p>
                <p className="font-medium">{newQrId}</p>
              </div>
            </div>

            <When truthy={!!errorMessage}>
              <p className="mt-4 px-8 text-center text-sm text-error-500">
                {errorMessage}
              </p>
            </When>

            <div className="mt-8 flex items-center gap-3">
              <Button
                className="flex-1"
                variant="secondary"
                onClick={() => {
                  setNewQrId(undefined);
                  setCurrentState("initial");
                  setErrorMessage("");
                }}
              >
                Rescan
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
      </Dialog>
    </DialogPortal>
  );
}
