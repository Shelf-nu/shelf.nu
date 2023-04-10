import { Link, NavLink } from "@remix-run/react";
import {
  AssetsIcon,
  ItemsIcon,
  SettingsIcon,
} from "~/components/icons/library";

import type { User } from "~/database";
import { tw } from "~/utils";

import SidebarBottom from "./bottom";

interface Props {
  user: User;
}

export default function Sidebar({ user }: Props) {
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
    <div className=" flex h-full flex-col ">
      <div>
        <Link to="." title="Home">
          <img
            src="/images/logo-full-color(x2).png"
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
                  tw(
                    "my-1 flex items-center gap-3 rounded-md px-3 py-2 text-text-md font-semibold text-gray-700 transition-all duration-75 hover:bg-gray-100 hover:text-gray-900",
                    isActive ? "bg-gray-100 text-gray-900" : ""
                  )
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
