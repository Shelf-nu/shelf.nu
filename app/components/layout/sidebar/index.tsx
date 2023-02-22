import { Link, NavLink } from "@remix-run/react";
import SidebarBottom from "./bottom";

// import Dropdown from "../shared/dropdown";

interface Props {
  email: string;
}

export default function Sidebar({ email }: Props) {
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
            name: "Concha Jaramillo",
            email: email,
            photo: "/images/occultist.png",
          }}
        />
      </div>
    </div>
  );
}
