import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { useQrScanner } from "~/hooks/use-qr-scanner";
import scannerCss from "~/styles/scanner.css";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: scannerCss },
];

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const header: HeaderData = {
      title: "Locations",
    };

    /** We get the userPrefs cookie so we can see if there is already a default camera */
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};

    return json({ header, scannerCameraId: cookie.scannerCameraId });
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
  const fetcher = useFetcher();
  const { scannerCameraId } = useLoaderData<typeof loader>();

  const { ref, videoMediaDevices } = useQrScanner(scannerCameraId);

  return (
    <>
      <Header title="QR code scanner" />
      <div className=" -mx-4 flex h-[calc(100vh-167px)] flex-col md:h-[calc(100vh-132px)]">
        {/* {!videoMediaDevices || videoMediaDevices.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center">
            <Spinner /> Waiting for permission to access camera.
          </div>
        ) : ( */}
        <div className="relative size-full min-h-[400px]">
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
        </div>
        {/* )} */}
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
