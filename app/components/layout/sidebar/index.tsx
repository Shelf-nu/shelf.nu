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
        <h1 className="text-3xl font-bold">
          <Link to=".">Shelf</Link>
        </h1>
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
