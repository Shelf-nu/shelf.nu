import { useRef } from "react";
import { Link, NavLink } from "@remix-run/react";
import { useAtom } from "jotai";
import {
  AssetsIcon,
  ItemsIcon,
  SettingsIcon,
  SwitchIcon,
  ActiveSwitchIcon,
  ShelfTypography,
} from "~/components/icons/library";

import type { User } from "~/database";
import { tw } from "~/utils";

import { toggleSidebarAtom, maintainUncollapsedAtom } from "./atoms";
import SidebarBottom from "./bottom";

interface Props {
  user: User;
}

export default function Sidebar({ user }: Props) {
  const [isSidebarCollapsed, toggleSidebar] = useAtom(toggleSidebarAtom);
  const [maintainUncollapsedSidebar, manageUncollapsedSidebar] = useAtom(
    maintainUncollapsedAtom
  );
  const mainNavigationRef = useRef<HTMLElement>(null);
  const menuItems = [
    {
      icon: <AssetsIcon />,
      to: "items",
      label: "Items",
    },
    {
      icon: <ItemsIcon />,
      to: "categories",
      label: "Categories",
    },
    {
      icon: <SettingsIcon />,
      to: "settings",
      label: "Settings",
      end: true,
    },
  ];

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
        <button className="menu-btn relative z-50" onClick={toggleSidebar}>
          <span
            className={tw(
              "mb-1 block h-[2px] w-[19px] rounded-full bg-gray-500 transition-all",
              isSidebarCollapsed ? "" : "translate-y-[6px] rotate-45"
            )}
          ></span>
          <span
            className={tw(
              "mb-1 block h-[2px] w-[14px] rounded-full bg-gray-500 transition-all",
              isSidebarCollapsed ? "opacity-1" : "invisible opacity-0"
            )}
          ></span>
          <span
            className={tw(
              "mb-1 block h-[2px] w-[19px] rounded-full bg-gray-500 transition-all",
              isSidebarCollapsed ? "" : "translate-y-[-6px] -rotate-45"
            )}
          ></span>
        </button>
      </header>
      <div
        onClick={toggleSidebar}
        className={tw(
          "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-25/10 backdrop-blur transition duration-300 ease-in-out md:hidden",
          isSidebarCollapsed ? "invisible opacity-0" : "visible"
        )}
      ></div>
      <aside
        id="main-navigation"
        ref={mainNavigationRef}
        onMouseEnter={toggleSidebar}
        onMouseLeave={toggleSidebar}
        className={tw(
          `fixed left-[-100%] top-0 z-30 flex h-screen w-80 flex-col border-r border-gray-200 bg-white p-4 shadow-[0px_20px_24px_-4px_rgba(16,24,40,0.08),_0px_8px_8px_-4px_rgba(16,24,40,0.03)] transition-all duration-300 ease-linear md:sticky md:left-0 md:px-6 md:py-8 md:duration-200`,
          isSidebarCollapsed
            ? "collapsed-navigation w-[92px] overflow-hidden"
            : "left-0 w-[270px] min-[350px]:w-[312px]"
        )}
      >
        <div className="navigation-header flex items-center justify-between">
          <Link to="." title="Home" className="flex items-center">
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
          <ul className="menu mt-6 md:mt-10">
            {menuItems.map((item) => (
              <li key={item.label}>
                <NavLink
                  className={({ isActive }) =>
                    tw(
                      "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-gray-100 hover:text-gray-900",
                      isActive ? "bg-gray-100 text-gray-900" : ""
                    )
                  }
                  to={item.to}
                  data-test-id={`${item.label.toLowerCase()}SidebarMenuItem`}
                >
                  <i className="icon text-gray-500">{item.icon}</i>
                  <span className="text whitespace-nowrap transition duration-200 ease-linear">
                    {item.label}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
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
