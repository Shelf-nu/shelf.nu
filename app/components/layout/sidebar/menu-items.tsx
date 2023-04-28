import { NavLink } from "@remix-run/react";
import { useAtom } from "jotai";
import {
  AssetsIcon,
  ItemsIcon,
  SettingsIcon,
} from "~/components/icons/library";
import { tw } from "~/utils";
import { toggleMobileNavAtom } from "./atoms";

const MenuItems = () => {
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
  const [, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  return (
    <>
      <ul className="menu mt-6 md:mt-10">
        {menuItems.map((item) => (
          <li key={item.label}>
            <NavLink
              className={({ isActive }) =>
                tw(
                  "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-gray-100 hover:text-gray-900",
                  isActive ? "bg-gray-100 text-gray-900" : ""
                )
              }
              to={item.to}
              data-test-id={`${item.label.toLowerCase()}SidebarMenuItem`}
              onClick={toggleMobileNav}
            >
              <i className="icon text-gray-500">{item.icon}</i>
              <span className="text whitespace-nowrap transition duration-200 ease-linear">
                {item.label}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  );
};

export default MenuItems;
