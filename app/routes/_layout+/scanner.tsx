import { useRef, useState } from "react";
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
import { CodeScanner } from "~/components/zxing-scanner/code-scanner";
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
  const height = isMd ? vh - 124 : vh - 102;
  const isNavigating = useRef(false); // Add a ref to track navigation status

  function handleQrDetectionSuccess(qrId: string) {
    // If navigation is already in progress, return early to prevent multiple navigations
    if (isNavigating.current) return;

    // Set the navigation flag to true to indicate navigation has started
    isNavigating.current = true;

    setPaused(true);

    setScanMessage("Redirecting to mapped asset...");
    navigate(`/qr/${qrId}`);
  }

  return (
    <>
      <Header title="QR code scanner" hidePageDescription={!isMd} />
      <div
        className="-mx-4 flex flex-col overflow-hidden"
        style={{ height: `${height}px` }}
      >
        <CodeScanner
          onQrDetectionSuccess={handleQrDetectionSuccess}
          paused={paused}
          setPaused={setPaused}
          scanMessage={scanMessage}
        />
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
