import { Link, NavLink } from "@remix-run/react";
import { ItemsIcon, SettingsIcon } from "~/components/icons/library";

import type { User } from "~/database";

import SidebarBottom from "./bottom";

interface Props {
  user: User;
}

export default function Sidebar({ user }: Props) {
  const menuItems = [
    {
      icon: <ItemsIcon />,
      to: "items",
      label: "Items",
    },
    {
      icon: <SettingsIcon />,
      to: "settings",
      label: "Settings",
      end: true,
    },
  ];

  return (
    <div className=" flex h-full flex-col text-white">
      <div>
        <Link to=".">
          <img
            src="/images/shelf-logo-white-text.png"
            alt="Shelf Logo"
            className="h-[30px]"
          />
        </Link>
      </div>
      <div className="flex-1">
        <ul className="mt-10">
          {menuItems.map((item) => (
            <li key={item.label}>
              <NavLink
                className={({ isActive }) =>
                  `text-md semibold my-1 flex items-center gap-3 rounded-md py-2 px-3 text-gray-100 transition-all duration-75 hover:bg-primary-700 hover:text-white ${
                    isActive ? "bg-primary-700 text-white" : ""
                  }`
                }
                to={item.to}
              >
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SidebarBottom
          user={{
            ...user,
          }}
        />
      </div>
    </div>
  );
}
