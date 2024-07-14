import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useZxing } from "react-zxing";
import { useClientNotification } from "~/hooks/use-client-notification";
import type { loader } from "~/routes/_layout+/scanner";
import { ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { Spinner } from "./shared/spinner";

type ZXingScannerProps = {
  onQrDetectionSuccess: (qrId: string) => void | Promise<void>;
  videoMediaDevices?: MediaDeviceInfo[];
  isLoading?: boolean;
};

export const ZXingScanner = ({
  videoMediaDevices,
  onQrDetectionSuccess,
  isLoading: incomingIsLoading,
}: ZXingScannerProps) => {
  const [sendNotification] = useClientNotification();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const { scannerCameraId } = useLoaderData<typeof loader>();
  const isProcessing = isFormProcessing(fetcher.state);
  const isLoading = isFormProcessing(navigation.state);

  // Function to decode the QR code
  const decodeQRCodes = async (result: string) => {
    if (result != null && !isLoading && !incomingIsLoading) {
      const regex = /^(https?:\/\/)([^/:]+)(:\d+)?\/qr\/([a-zA-Z0-9]+)$/;
      /** We make sure the value of the QR code matches the structure of Shelf qr codes */
      const match = result.match(regex);
      if (!match) {
        /** If the QR code does not match the structure of Shelf qr codes, we show an error message */
        sendNotification({
          title: "QR Code Not Valid",
          message: "Please Scan valid asset QR",
          icon: { name: "trash", variant: "error" },
        });
        return;
      }

      const qrId = match[4]; // Get the last segment of the URL as the QR id
      await onQrDetectionSuccess(qrId);
    }
  };

  const { ref } = useZxing({
    deviceId: scannerCameraId,
    constraints: { video: true, audio: false },
    timeBetweenDecodingAttempts: 100,
    async onDecodeResult(result) {
      await decodeQRCodes(result.getText());
    },
    onError(cause) {
      throw new ShelfError({
        message: "Unable to access media devices permission",
        status: 403,
        label: "Scanner",
        cause,
      });
    },
  });

  return (
    <div className="relative size-full min-h-[400px]">
      {isProcessing ? (
        <div className="mt-4 flex flex-col items-center justify-center">
          <Spinner /> Switching cameras...
        </div>
      ) : (
        <>
          <video
            ref={ref}
            width="100%"
            autoPlay={true}
            controls={false}
            muted={true}
            playsInline={true}
            className={`pointer-events-none size-full object-cover object-center`}
          />
          <div className="absolute left-1/2 top-1/2 z-10 h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 -translate-y-1/2 rounded border-4 border-white md:h-[600px]">
            <div className="relative size-full">
              <div className="absolute bottom-3 left-1/2 size-20 h-1 w-[calc(100%-40px)] -translate-x-1/2 rounded-full bg-white" />
            </div>
          </div>

          <fetcher.Form
            method="post"
            action="/api/user/prefs/scanner-camera"
            className="relative"
            onChange={(e) => {
              const form = e.currentTarget;
              fetcher.submit(form);
            }}
          >
            {videoMediaDevices && videoMediaDevices?.length > 0 ? (
              <select
                className="absolute bottom-3 left-3 z-10 w-[calc(100%-24px)] rounded border-0 md:left-auto md:right-3 md:w-auto"
                name="scannerCameraId"
                defaultValue={scannerCameraId}
              >
                {videoMediaDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label ? device.label : `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            ) : null}
          </fetcher.Form>
        </>
      )}
    </div>
  );
};
