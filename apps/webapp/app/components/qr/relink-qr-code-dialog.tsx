import { useCallback, useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { isFormProcessing } from "~/utils/form";
import Icon from "../icons/icon";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import type { OnCodeDetectionSuccessProps } from "../scanner/code-scanner";
import { CodeScanner } from "../scanner/code-scanner";
import { Button } from "../shared/button";
import When from "../when/when";

export type RelinkQrCodeActionData = {
  success: boolean;
  error?: { message: string };
};

type RelinkQrCodeDialogProps = {
  open: boolean;
  onClose: () => void;
  itemName: string;
  currentQrId?: string;
  itemLabel?: string;
  actionData?: RelinkQrCodeActionData | null;
};

type CurrentState = "initial" | "qr-selected";

export function RelinkQrCodeDialog({
  open,
  onClose,
  itemName,
  currentQrId,
  itemLabel = "item",
  actionData,
}: RelinkQrCodeDialogProps) {
  const [currentState, setCurrentState] = useState<CurrentState>("initial");
  const [newQrId, setNewQrId] = useState<string>();
  const [errorMessage, setErrorMessage] = useState("");

  const navigation = useNavigation();
  const isSubmitting = isFormProcessing(navigation.state);

  const savedCameraId = useScannerCameraId();

  const isNewCodeSameAsCurrent = currentQrId === newQrId;

  function handleQrDetectionSuccess({
    value: qrId,
    error,
    type,
  }: OnCodeDetectionSuccessProps) {
    if (type === "barcode") {
      setErrorMessage("Please scan a QR code, not a barcode.");
      return;
    }

    if (error && error !== "") {
      setErrorMessage(error);
    }

    setNewQrId(qrId);

    if (currentQrId === qrId) {
      setErrorMessage(
        `The new code you scanned is the same as the current code of the ${itemLabel}. Please scan a different code.`
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
                <p className="text-gray-600">{itemName}</p>
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
            {/*
             * The scanner is sized by flex rather than pinned to 450px: it
             * PREFERS 450px (basis) but shrinks down to 200px when a short
             * viewport leaves less room, so the code confirmation and the
             * Link/Rescan actions below stay on screen instead of being
             * pushed under the fold. `min-h-[200px]` deliberately overrides
             * CodeScanner's own `min-h-[400px]` floor for this dialog only.
             *
             * The removed `[&_.info-overlay]:h-[450px]` and
             * `scannerModeClassName="h-[450px]"` were only there to match the
             * fixed 450px: InfoOverlay is already `absolute inset-0` and
             * ScannerMode is already `h-full`, so both now track the flexed
             * height on their own. `overlayClassName` keeps its preferred
             * height because the base overlay already caps itself at
             * `max-h-[90%] md:max-h-[95%]` of the scanner.
             */}
            <CodeScanner
              className="!h-auto min-h-[200px] shrink basis-[450px]"
              overlayClassName="md:h-[320px] max-w-xs"
              isLoading={false}
              onCodeDetectionSuccess={handleQrDetectionSuccess}
              allowNonShelfCodes
              hideBackButtonText
              paused={!!newQrId}
              setPaused={() => {}}
              scannerModeCallback={() => {}}
              savedCameraId={savedCameraId}
            />

            {/* shrink-0: the scanner above is the only element allowed to give
                up height when the viewport is short. */}
            <div className="flex shrink-0 items-center justify-center gap-4 p-4">
              <div className="flex-1 truncate text-right">
                <p className="uppercase text-gray-500">Current code</p>
                <p
                  className="truncate font-medium"
                  title={currentQrId ? currentQrId : "Not linked yet"}
                >
                  {currentQrId ? currentQrId : "Not linked yet"}
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

            {/* Sticky so the primary action stays reachable when a short
                viewport forces the dialog body to scroll (the 450px scanner
                above can otherwise push this footer off-screen). */}
            <div className="sticky bottom-0 z-10 flex shrink-0 items-center gap-4 border-t border-gray-200 bg-white p-4">
              <Button
                type="button"
                className="flex-1"
                variant="secondary"
                disabled={!newQrId}
                onClick={() => {
                  setNewQrId(undefined);
                  setErrorMessage("");

                  if (document) {
                    const input = document.querySelector(
                      ".scanner-mode-input"
                    ) as HTMLInputElement;
                    if (input) {
                      input.disabled = false;
                      input.focus();
                      input.value = "";
                    }
                  }
                }}
              >
                Rescan
              </Button>
              <Button
                type="button"
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
                <span className="font-bold">{itemName}</span>? The current code
                will become unlinked.
              </p>
            </div>

            <div className="mb-1 flex items-center gap-2.5 rounded border border-gray-200 p-2">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 p-2.5">
                <ArrowLeftIcon />
              </div>
              <div>
                <p className="uppercase text-gray-600">Current code</p>
                <p className="font-medium">{currentQrId ?? "N/A"}</p>
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
                type="button"
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
