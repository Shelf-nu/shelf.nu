import { Link, NavLink } from "@remix-run/react";
import type { User } from "~/database";

import SidebarBottom from "./bottom";

// import Dropdown from "../shared/dropdown";

interface Props {
  user: User;
}

export default function Sidebar({ user }: Props) {
  return (
    <div className=" flex h-full flex-col text-white">
      <div>
        {" "}
        <h1 className="text-3xl font-bold">
          <Link to=".">Shelf</Link>
        </h1>
      </div>
      <div className="flex-1">
        <ul className="mt-10">
          <li>
            <NavLink
              className={({ isActive }) => {
                return `block py-4 text-xl ${isActive ? "border-b" : ""}`;
              }}
              to={"items"}
            >
              Items
            </NavLink>
          </li>
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
