import { json, type MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Spinner } from "~/components/shared/spinner";
import { useQrScanner } from "~/hooks/use-video-devices";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

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
  const {
    ref,
    videoMediaDevices,
    selectedDevice,
    setSelectedDevice,
    hasPermission,
    noCamera,
  } = useQrScanner();

  return (
    <>
      <Header title="QR code scanner" />
      <div className=" flex h-[calc(100vh-191px)] flex-col md:h-[calc(100vh-156px)]">
        <div className="m-auto h-5/6 min-h-[400px] py-6 xl:w-[70%]">
          <div className="relative h-full">
            {noCamera ? (
              <div className="flex flex-col items-center justify-center">
                Your device doesnt have a camera
              </div>
            ) : !hasPermission ? (
              <div className="flex flex-col items-center justify-center">
                <Spinner /> Waiting for permission to access camera.
              </div>
            ) : (
              <>
                <video
                  ref={ref}
                  width="100%"
                  autoPlay={true}
                  controls={false}
                  className={`pointer-events-none h-full object-cover`}
                />
                {videoMediaDevices && videoMediaDevices?.length > 0 ? (
                  <select
                    className="absolute bottom-3 left-3 z-10 w-[calc(100%-24px)] rounded border-0"
                    name="devices"
                    onChange={(e) => {
                      setSelectedDevice(e.currentTarget.value);
                    }}
                    defaultValue={selectedDevice}
                  >
                    {videoMediaDevices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label ? device.label : `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
