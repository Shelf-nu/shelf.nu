import { useState } from "react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useNavigate } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { WasmScanner } from "~/components/zxing-scanner/wasm-scanner";
import { useVideoDevices } from "~/hooks/use-video-devices";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import scannerCss from "~/styles/scanner.css?url";
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
  const navigate = useNavigate();
  const [paused, setPaused] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string>(
    "Processing QR code..."
  );

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 124 : vh - 158;
  const { devices, DevicesPermissionComponent } = useVideoDevices();

  function handleQrDetectionSuccess(qrId: string) {
    if (!paused) {
      setPaused(true);
      setScanMessage("Redirecting to mapped asset...");
      navigate(`/qr/${qrId}`);
    }
  }

  return (
    <>
      <Header title="QR code scanner" />
      <div
        className="-mx-4 flex flex-col overflow-hidden"
        style={{ height: `${height}px` }}
      >
        {devices ? (
          <WasmScanner
            onQrDetectionSuccess={handleQrDetectionSuccess}
            devices={devices}
            paused={paused}
            scanMessage={scanMessage}
          />
        ) : (
          <DevicesPermissionComponent />
        )}
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
