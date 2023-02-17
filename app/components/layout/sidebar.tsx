import { Link, NavLink } from "@remix-run/react";

import { LogoutButton } from "~/modules/auth";

interface Props {
  email?: string;
}
export default function Sidebar({ email }: Props) {
  return (
    <div className=" text-white">
      <h1 className="text-3xl font-bold">
        <Link to=".">shelf.nu 🏺</Link>
      </h1>
      <div className=" items-center gap-4">
        {email && <p>{email}</p>}
        <LogoutButton />
      </div>
      <ul className="mt-10">
        <li>
          <NavLink
            className={({ isActive }) =>
              `block border-b py-4 text-xl ${isActive ? "bg-red" : ""}`
            }
            to={"items"}
          >
            Items
          </NavLink>
        </li>
      </ul>
    </div>
  );
}
