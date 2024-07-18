import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useZxing } from "react-zxing";
import { useClientNotification } from "~/hooks/use-client-notification";
import type { loader } from "~/routes/_layout+/scanner";
import { ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./forms/select";
import Icon from "./icons/icon";
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
  const decodeQRCodes = (result: string) => {
    if (result != null && !isLoading && !incomingIsLoading) {
      const regex = /^(https?:\/\/)([^/:]+)(:\d+)?\/qr\/([a-zA-Z0-9]+)$/;
      /** We make sure the value of the QR code matches the structure of Shelf qr codes */
      const match = result.match(regex);
      if (!match) {
        /**
         * @TODO same as the other comments. Lets implement a way to manage those messages specifically for the scanner and do it all client side
         * If the QR code does not match the structure of Shelf qr codes, we show an error message
         * */
        sendNotification({
          title: "QR Code Not Valid",
          message: "Please Scan valid asset QR",
          icon: { name: "trash", variant: "error" },
        });
        return;
      }

      const qrId = match[4]; // Get the last segment of the URL as the QR id
      void onQrDetectionSuccess(qrId);
    }
  };

  const { ref } = useZxing({
    deviceId: scannerCameraId,
    constraints: { video: true, audio: false },
    timeBetweenDecodingAttempts: 50,
    onDecodeResult(result) {
      void decodeQRCodes(result.getText());
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
    <div className="relative size-full min-h-[400px] overflow-hidden">
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
            className="pointer-events-none size-full object-cover object-center"
          />

          <fetcher.Form
            method="post"
            action="/api/user/prefs/scanner-camera"
            onChange={(e) => {
              const form = e.currentTarget;
              fetcher.submit(form);
            }}
          >
            {videoMediaDevices && videoMediaDevices?.length > 0 ? (
              <Select name="scannerCameraId" defaultValue={scannerCameraId}>
                <SelectTrigger
                  hideArrow
                  className="absolute right-2 top-3 z-10 size-12 justify-center overflow-hidden rounded-full border-none bg-transparent pb-1 text-gray-25/50 focus:border-none focus:ring-0 focus:ring-offset-0"
                >
                  <SelectValue placeholder={<Icon icon="settings" />}>
                    <Icon icon="settings" />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  alignOffset={10}
                  className="mt-1 max-w-96 md:min-w-80"
                >
                  {videoMediaDevices.map((device, index) => (
                    <SelectItem
                      key={device.deviceId}
                      value={device.deviceId}
                      className="cursor-pointer"
                    >
                      {device.label ? device.label : `Device ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </fetcher.Form>

          {/* Overlay */}
          <div className="absolute left-1/2 top-1/2 h-[400px] w-11/12 max-w-[600px] -translate-x-1/2 -translate-y-1/2 rounded border-4 border-white shadow-camera-overlay before:absolute before:bottom-3 before:left-1/2 before:h-1 before:w-[calc(100%-40px)] before:-translate-x-1/2 before:rounded-full before:bg-white md:h-[600px]" />
        </>
      )}
    </div>
  );
};
