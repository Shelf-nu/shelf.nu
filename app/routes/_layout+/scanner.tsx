import { useState } from "react";
import type { MetaFunction } from "@remix-run/node";
import { useNavigate, Link, json } from "@remix-run/react";
import { useMediaDevices } from "react-media-devices";
import { useZxing } from "react-zxing";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { useClientNotification } from "~/hooks/use-client-notification";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import type { ErrorLabel } from "~/utils/error";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

const label: ErrorLabel = "Scanner";

export function loader() {
  try {
    const header: HeaderData = {
      title: "Locations",
    };
    return json({ header });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => <Link to="/scanner">QR code scanner</Link>,
};

export const meta: MetaFunction<typeof loader> = () => [
  { title: appendToMetaTitle("Qr code scanner") },
];

const QRScanner = () => {
  const [sendNotification] = useClientNotification();
  const navigate = useNavigate();
  const [selectedDevice, setSelectedDevice] = useState("");

  const { devices } = useMediaDevices({
    constraints: {
      video: true,
      audio: false,
    },
  });
  const videoMediaDevices = devices
    ? devices.filter((device) => device.kind === "videoinput")
    : [];

  const { ref: videoRef } = useZxing({
    deviceId: selectedDevice,
    constraints: { video: true, audio: false },
    onDecodeResult(result) {
      decodeQRCodes(result.getText());
    },
    onError(cause) {
      throw new ShelfError({
        message: "Unable to access media devices permission",
        status: 403,
        label,
        cause,
      });
    },
  });

  const decodeQRCodes = (result: string) => {
    if (result != null) {
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

      sendNotification({
        title: "Shelf's QR Code detected",
        message: "Redirecting to mapped asset",
        icon: { name: "success", variant: "success" },
      });
      const qrId = match[4]; // Get the last segment of the URL as the QR id
      navigate(`/qr/${qrId}`);
    }
  };

  return (
    <>
      <Header title="QR code scanner" />
      <div className=" flex h-[calc(100vh-191px)] flex-col md:h-[calc(100vh-156px)]">
        <div className="m-auto h-5/6 min-h-[400px] py-6 xl:w-[70%]">
          <div className="relative h-full">
            <video
              ref={videoRef}
              width="100%"
              autoPlay={true}
              controls={false}
              className={`pointer-events-none h-full object-cover`}
            />
            {videoMediaDevices.length > 0 && (
              <select
                className="absolute bottom-3 left-3 z-10 w-[calc(100%-24px)] rounded border-0"
                name="devices"
                onChange={(e) => {
                  setSelectedDevice(e.currentTarget.value);
                }}
                defaultValue={selectedDevice}
              >
                {videoMediaDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
