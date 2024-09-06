import { TriangleLeftIcon } from "@radix-ui/react-icons";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useZxing } from "react-zxing";

import type { loader } from "~/routes/_layout+/scanner";
import { ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { isQrId } from "~/utils/id";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import Icon from "../icons/icon";
import { Spinner } from "../shared/spinner";

type ZXingScannerProps = {
  onQrDetectionSuccess?: (qrId: string) => void | Promise<void>;
  videoMediaDevices?: MediaDeviceInfo[];
  isLoading?: boolean;
  allowDuplicateScan?: boolean;
  backButtonText?: string;
};

export const ZXingScanner = ({
  videoMediaDevices,
  onQrDetectionSuccess,
  isLoading: incomingIsLoading,
  allowDuplicateScan = false,
  backButtonText = "Back",
}: ZXingScannerProps) => {
  const { scannerCameraId } = useLoaderData<typeof loader>();

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const fetcher = useFetcher();
  const isSwitchingCamera = isFormProcessing(fetcher.state);

  // Function to decode the QR code
  const decodeQRCodes = (result: string) => {
    if (result != null && !isLoading && !incomingIsLoading) {
      /**
       * - ^(https?:\/\/[^\/]+\/ matches the protocol, domain, and the initial slash.
       * - (?:qr\/)? optionally matches the /qr/ part.
       * - ([a-zA-Z0-9]+))$ matches the QR ID which is the last segment of the URL.
       * - $ ensures that there are no additional parts after the QR ID.
       */
      // Regex to match both old and new QR code structures
      const regex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;

      /** We make sure the value of the QR code matches the structure of Shelf qr codes */
      const match = result.match(regex);

      if (!match) {
        return;
      }

      const qrId = match[2]; // Get the QR id from the URL
      if (!isQrId(qrId)) {
        return;
      }

      // if (!allowDuplicateScan) {
      //   return;
      // }

      /** At this point, a QR is successfully detected, so we can vibrate user's device for feedback */
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(200);
      }

      onQrDetectionSuccess && void onQrDetectionSuccess(qrId);
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
      {isSwitchingCamera ? (
        <div className="mt-4 flex flex-col items-center justify-center">
          <Spinner /> Switching cameras...
        </div>
      ) : (
        <>
          <Link
            to=".."
            className="absolute left-0 top-0 z-[999] inline-flex items-center justify-start p-2 text-[11px] leading-[11px] text-white"
          >
            <TriangleLeftIcon className="size-[14px]" />{" "}
            <span className="mt-[-0.5px]">{backButtonText}</span>
          </Link>
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
          <div className="absolute left-1/2 top-[75px] h-[400px] w-11/12 max-w-[600px] -translate-x-1/2  rounded border-4 border-white shadow-camera-overlay before:absolute before:bottom-3 before:left-1/2 before:h-1 before:w-[calc(100%-40px)] before:-translate-x-1/2 before:rounded-full before:bg-white md:h-[600px]" />
        </>
      )}
    </div>
  );
};
