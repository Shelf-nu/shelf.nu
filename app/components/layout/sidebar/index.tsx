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
  const [maintainUncollapsedSidebar, manageUncollapsedSidebar] = useAtom(maintainUncollapsedAtom);
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
    <aside
      id="main-navigation"
      ref={mainNavigationRef}
      onMouseEnter={toggleSidebar}
      onMouseLeave={toggleSidebar}
      className={tw(
        `sticky top-0 flex h-screen w-80 flex-col border-r border-gray-200 px-6 py-8 transition-all duration-200 ease-linear`,
        isSidebarCollapsed
          ? "collapsed-navigation w-[92px] overflow-hidden"
          : "w-[312px]"
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
          className="transition-all duration-200 ease-linear"
          onClick={manageUncollapsedSidebar}
        >
          <i className="icon text-gray-500">
            {maintainUncollapsedSidebar ? <ActiveSwitchIcon /> : <SwitchIcon />}
          </i>
        </button>
      </div>
      <div className="flex-1">
        <ul className="menu mt-10">
          {menuItems.map((item) => (
            <li key={item.label}>
              <NavLink
                className={({ isActive }) =>
                  tw(
                    "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-text-md font-semibold text-gray-700 transition-all duration-75 hover:bg-gray-100 hover:text-gray-900",
                    isActive ? "bg-gray-100 text-gray-900" : ""
                  )
                }
                to={item.to}
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
  );
}
