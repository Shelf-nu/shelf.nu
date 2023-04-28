import { useRef } from "react";
import { Link } from "@remix-run/react";
import { useAtom } from "jotai";
import {
  SwitchIcon,
  ActiveSwitchIcon,
  ShelfTypography,
} from "~/components/icons/library";

import type { User } from "~/database";
import { tw } from "~/utils";

import {
  toggleSidebarAtom,
  maintainUncollapsedAtom,
  toggleMobileNavAtom,
} from "./atoms";
import SidebarBottom from "./bottom";
import MenuButton from "./menu-button";
import MenuItems from "./menu-items";
import Overlay from "./overlay";

interface Props {
  user: User;
}

export default function Sidebar({ user }: Props) {
  const [isSidebarCollapsed, toggleSidebar] = useAtom(toggleSidebarAtom);
  const [maintainUncollapsedSidebar, manageUncollapsedSidebar] = useAtom(
    maintainUncollapsedAtom
  );
  const [isMobileNavOpen, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  const mainNavigationRef = useRef<HTMLElement>(null);
  

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
        onMouseEnter={toggleSidebar}
        onMouseLeave={toggleSidebar}
        className={tw(
          `fixed top-0 z-30 flex h-screen flex-col border-r border-gray-200 bg-white p-4 shadow-[0px_20px_24px_-4px_rgba(16,24,40,0.08),_0px_8px_8px_-4px_rgba(16,24,40,0.03)] transition-all duration-300 ease-linear md:sticky md:left-0 md:px-6 md:py-8 md:shadow-none md:duration-200`,
          isSidebarCollapsed
            ? "collapsed-navigation md:w-[92px] md:overflow-hidden"
            : "md:left-0 md:w-[312px]",
          isMobileNavOpen
            ? "left-0 w-[270px] overflow-hidden min-[350px]:w-[312px]"
            : "left-[-100%]"
        )}
      >
        <div className="navigation-header flex items-center justify-between">
          <Link to="." title="Home" className="flex items-center" onClick={toggleMobileNav}>
            <img
              src="/images/shelf-symbol.png"
              alt="Shelf Logo"
              className="mx-1.5 inline h-[32px]"
            />
            <span className="logo-text transition duration-200 ease-linear">
              <ShelfTypography />
            </span>
          </Link>
          <button
            className="hidden transition-all duration-200 ease-linear md:block"
            onClick={manageUncollapsedSidebar}
          >
            <i className="icon text-gray-500">
              {maintainUncollapsedSidebar ? (
                <ActiveSwitchIcon />
              ) : (
                <SwitchIcon />
              )}
            </i>
          </button>
        </div>
        <div className="flex-1">       
            <MenuItems />
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
