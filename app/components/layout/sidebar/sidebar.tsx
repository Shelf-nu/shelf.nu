import { useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import { ScanQRIcon, ShelfTypography } from "~/components/icons/library";
import {
  useMediaStream,
  useStopMediaStream,
} from "~/components/scan-qr/media-stream-provider";
import QRScanner from "~/components/scan-qr/qrcode-scanner";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils";

import { toggleMobileNavAtom } from "./atoms";
import SidebarBottom from "./bottom";
import MenuButton from "./menu-button";
import MenuItems from "./menu-items";
import { OrganizationSelect } from "./organization-select";
import Overlay from "./overlay";

export default function Sidebar() {
  const { user, minimizedSidebar, currentOrganizationId } =
    useLoaderData<typeof loader>();
  const [isMobileNavOpen, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  const mainNavigationRef = useRef<HTMLElement>(null);

  const [showScanner, setShowScanner] = useState(false);

  const { stopMediaStream } = useMediaStream();
  useStopMediaStream(stopMediaStream);

  const handleScannerClose = () => {
    stopMediaStream();
    setShowScanner(false);
  };

  /** We use optimistic UI for folding of the sidebar
   * As we are making a request to the server to store the cookie,
   * we need to use this approach, otherwise the sidebar will close/open
   * only once the response is received from the server
   */
  const sidebarFetcher = useFetcher();
  let optimisticMinimizedSidebar = minimizedSidebar;
  if (sidebarFetcher.formData) {
    optimisticMinimizedSidebar =
      sidebarFetcher.formData.get("minimizeSidebar") === "open";
  }
  const [workspaceSwitching] = useAtom(switchingWorkspaceAtom);

  return (
    <>
      {/* this component is named sidebar as of now but also serves as a mobile navigation header in mobile device */}
      <header
        id="header"
        className="flex items-center justify-between border-b bg-white p-4 md:hidden"
      >
        <Link to="." title="Home" className="block h-[32px]">
          <img
            src="/images/logo-full-color(x2).png"
            alt="logo"
            className="h-full"
          />
        </Link>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowScanner(true)}
            title="Scan QR Code"
            className="relative flex items-center justify-center px-2 transition"
          >
            <ScanQRIcon />
          </button>
          <MenuButton />
        </div>
      </header>
      {showScanner && <QRScanner onClose={handleScannerClose} />}

      <Overlay />
      <aside
        id="main-navigation"
        ref={mainNavigationRef}
        className={tw(
          `main-navigation fixed top-0 z-30 flex h-screen max-h-screen flex-col border-r border-gray-200 bg-white p-4 shadow-[0px_20px_24px_-4px_rgba(16,24,40,0.08),_0px_8px_8px_-4px_rgba(16,24,40,0.03)] transition-all duration-300 ease-linear md:sticky md:left-0 md:px-4 md:py-8 md:shadow-none md:duration-200`,
          optimisticMinimizedSidebar
            ? "collapsed-navigation md:w-[82px] md:overflow-hidden"
            : "md:left-0 md:w-[312px]",
          isMobileNavOpen ? "left-0 w-[312px] overflow-hidden " : "left-[-100%]"
        )}
      >
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden">
          <div className="navigation-header flex items-center justify-between">
            <Link
              to="."
              title="Home"
              className="logo flex items-center"
              onClick={toggleMobileNav}
            >
              <img
                src="/images/shelf-symbol.png"
                alt="Shelf Logo"
                className="mx-1.5 inline h-[32px]"
              />
              <span className="logo-text transition duration-200 ease-linear">
                <ShelfTypography />
              </span>
            </Link>
          </div>
          <div className="">
            <OrganizationSelect key={currentOrganizationId} />
          </div>
          <div className={tw("flex-1", workspaceSwitching ? "opacity-50" : "")}>
            <MenuItems fetcher={sidebarFetcher} />
          </div>
        </div>

        <div className={tw("", workspaceSwitching ? "opacity-50" : "")}>
          <SidebarBottom
            isSidebarMinimized={optimisticMinimizedSidebar}
            user={user}
          />
        </div>
      </aside>
    </>
  );
}
