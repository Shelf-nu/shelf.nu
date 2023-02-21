import { Link, NavLink } from "@remix-run/react";

import { LogoutButton } from "~/modules/auth";
import Dropdown from "../shared/dropdown";

interface Props {
  email?: string;
}
export default function Sidebar({ email }: Props) {
  const menuItems = [
    {
      title: "Logout",
      to: "/logout",
    },
  ];

  return (
    <div className=" text-white">
      <h1 className="text-3xl font-bold">
        <Link to=".">shelf.nu 🏺</Link>
      </h1>
      <div className=" mb-4 items-center gap-4">
        {email && <Dropdown title={email} items={menuItems} className="my-4" />}
      </div>
      <hr />

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
  );
}
