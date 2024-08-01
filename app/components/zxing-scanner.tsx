import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
} from "@remix-run/react";
import { useZxing } from "react-zxing";
import { useClientNotification } from "~/hooks/use-client-notification";
import type { loader } from "~/routes/_layout+/scanner";
import { SERVER_URL, URL_SHORTENER } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { Spinner } from "./shared/spinner";
import { isQrId } from "~/utils/id";

export const ZXingScanner = ({
  videoMediaDevices,
}: {
  videoMediaDevices: MediaDeviceInfo[] | undefined;
}) => {
  const [sendNotification] = useClientNotification();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const { scannerCameraId } = useLoaderData<typeof loader>();
  const isProcessing = isFormProcessing(fetcher.state);
  const isRedirecting = isFormProcessing(navigation.state);

  // Function to decode the QR code
  const decodeQRCodes = (result: string) => {
    if (result != null && !isRedirecting) {
      /**
       * - ^(https?:\/\/[^\/]+\/ matches the protocol, domain, and the initial slash.
       * - (?:qr\/)? optionally matches the /qr/ part.
       * - ([a-zA-Z0-9]+))$ matches the QR ID which is the last segment of the URL.
       */
      // Regex to match both old and new QR code structures
      const regex = /^(https?:\/\/[^\/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;

      /** We make sure the value of the QR code matches the structure of Shelf QR codes */
      const match = result.match(regex);
      if (!match) {
        /** If the QR code does not match the structure of Shelf QR codes, we show an error message */
        sendNotification({
          title: "QR Code Not Valid",
          message: "Please Scan valid asset QR",
          icon: { name: "trash", variant: "error" },
        });
        return;
      }

      const qrId = match[2]; // Get the QR id from the URL
      if (!isQrId(qrId)) {
        sendNotification({
          title: "QR ID Not Valid",
          message: "Please Scan valid asset QR",
          icon: { name: "trash", variant: "error" },
        });
        return;
      }

      sendNotification({
        title: "Shelf's QR Code detected",
        message: "Redirecting to mapped asset",
        icon: { name: "success", variant: "success" },
      });

      navigate(`/qr/${qrId}`);
    }
  };

  const { ref } = useZxing({
    deviceId: scannerCameraId,
    constraints: { video: true, audio: false },
    timeBetweenDecodingAttempts: 100,
    onDecodeResult(result) {
      decodeQRCodes(result.getText());
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
