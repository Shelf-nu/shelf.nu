import { Link, NavLink } from "@remix-run/react";
import type { User } from "~/database";

import SidebarBottom from "./bottom";

interface Props {
  user: User;
}

export default function Sidebar({ user }: Props) {
  const menuItems = [
    {
      to: "items",
      label: "Items",
    },
    {
      to: "settings",
      label: "Settings",
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
                  `block py-4 text-xl ${isActive ? "border-b" : ""}`
                }
                to={item.to}
              >
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
