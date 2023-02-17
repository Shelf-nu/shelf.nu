import { Link, NavLink } from "@remix-run/react";

export default function Sidebar() {
  return (
    <div>
      <ul>
        <li>
          <NavLink
            className={({ isActive }) =>
              `block border-b p-4 text-xl ${isActive ? "bg-red" : ""}`
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
