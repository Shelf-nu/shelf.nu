import { useRef } from "react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import { ShelfTypography } from "~/components/icons/library";

import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils";

import { toggleMobileNavAtom } from "./atoms";
import SidebarBottom from "./bottom";
import MenuButton from "./menu-button";
import MenuItems from "./menu-items";
import Overlay from "./overlay";

export default function Sidebar() {
  const { user, minimizedSidebar } = useLoaderData<typeof loader>();
  const [isMobileNavOpen, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  const mainNavigationRef = useRef<HTMLElement>(null);

  /** We use optimistic UI for folding of the sidebar
   * As we are making a request to the server to store the cookie,
   * we need to use this approach, otherwise the sidebar will close/open
   * only once the response is received from the server
   */
  const sidebarFetcher = useFetcher();
  let optimisticMinimizedSidebar = minimizedSidebar;
  if (sidebarFetcher.formData) {
    optimisticMinimizedSidebar =
      sidebarFetcher.formData.get("minimizeSidebar") === "true";
  }
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
        <MenuButton />
      </header>
      <Overlay />
      <aside
        id="main-navigation"
        ref={mainNavigationRef}
        className={tw(
          `fixed top-0 z-30 flex h-screen max-h-screen flex-col border-r border-gray-200 bg-white p-4 shadow-[0px_20px_24px_-4px_rgba(16,24,40,0.08),_0px_8px_8px_-4px_rgba(16,24,40,0.03)] transition-all duration-300 ease-linear md:sticky md:left-0 md:px-6 md:py-8 md:shadow-none md:duration-200`,
          optimisticMinimizedSidebar
            ? "collapsed-navigation md:w-[92px] md:overflow-hidden"
            : "md:left-0 md:w-[312px]",
          isMobileNavOpen ? "left-0 w-[312px] overflow-hidden " : "left-[-100%]"
        )}
      >
        <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <div className="navigation-header flex items-center justify-between">
            <Link
              to="."
              title="Home"
              className="flex items-center"
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
            {/* <button
              className={tw(
                " hide-show-sidebar bg-gray-100 px-3 py-[10px] transition-all duration-200 ease-linear hover:bg-gray-200 md:block",
                maintainUncollapsedSidebar
                  ? "rotate-180"
                  : " fixed left-[93px] md:hidden"
              )}
              onClick={manageUncollapsedSidebar}
            >
              <i className="icon text-gray-500">
                <ChevronRight />
              </i>
            </button> */}
          </div>
          <div className="flex-1">
            <MenuItems fetcher={sidebarFetcher} />
          </div>
        </div>

        <div className="mt-auto">
          <SidebarBottom
            user={{
              ...user,
            }}
          />
        </div>
      </aside>
    </>
  );
}
