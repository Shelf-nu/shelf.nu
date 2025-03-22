import { useCallback, useRef, useState } from "react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useNavigate } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { OnQrDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { CodeScanner } from "~/components/scanner/code-scanner";
import { scannerActionAtom } from "~/components/scanner/drawer/action-atom";
import { ActionSwitcher } from "~/components/scanner/drawer/action-switcher";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import { tw } from "~/utils/tw";

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
  const height = isMd ? vh - 67 : vh - 102;
  const isNavigating = useRef(false); // Add a ref to track navigation status
  const addItem = useSetAtom(addScannedItemAtom);
  const action = useAtomValue(scannerActionAtom);

  // Custom setPaused function that only pauses for "View asset"
  const handleSetPaused = useCallback(
    (value: boolean) => {
      if (action === "View asset") {
        setPaused(value);
      }
      // For other actions, do nothing when trying to pause
    },
    [action]
  );

  function handleQrDetectionSuccess({
    qrId,
    error,
  }: OnQrDetectionSuccessProps) {
    switch (action) {
      case "View asset":
        // If navigation is already in progress, return early
        if (isNavigating.current) {
          return;
        }

        // Set the navigation flag to true and navigate
        isNavigating.current = true;
        handleSetPaused(true); // Pause the scanner
        setScanMessage("Redirecting to mapped asset...");
        navigate(`/qr/${qrId}`);
        break;

      case "Assign custody":
      case "Release custody":
      case "Add to location":
        // For bulk actions, just add the item without pausing
        addItem(qrId, error);
        break;

      default:
        break;
    }
  }

  return (
    <>
      <Header title="QR code scanner" hidePageDescription={true} />
      <div
        className="-mx-4 flex flex-col overflow-hidden"
        style={{ height: `${height}px` }}
      >
        <CodeScanner
          onQrDetectionSuccess={handleQrDetectionSuccess}
          paused={paused}
          setPaused={handleSetPaused}
          scanMessage={scanMessage}
          actionSwitcher={<ActionSwitcher />}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
        />
      </div>
    </>
  );
};

export default QRScanner;

export const ErrorBoundary = () => <ErrorContent />;
