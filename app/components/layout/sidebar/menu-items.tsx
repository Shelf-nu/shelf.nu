import { NavLink } from "@remix-run/react";
import { useAtom } from "jotai";
import {
  AssetsIcon,
  ItemsIcon,
  QuestionsIcon,
  SettingsIcon,
} from "~/components/icons/library";
import { CrispButton } from "~/components/marketing/crisp";
import { tw } from "~/utils";
import { toggleMobileNavAtom } from "./atoms";
import { ChatWithAnExpert } from "./chat-with-an-expert";

const menuItemsTop = [
  {
    icon: <AssetsIcon />,
    to: "assets",
    label: "Assets",
  },
  {
    icon: <ItemsIcon />,
    to: "categories",
    label: "Categories",
  },
];
const menuItemsBottom = [
  {
    icon: <SettingsIcon />,
    to: "settings",
    label: "Settings",
    end: true,
  },
];

const MenuItems = () => {
  const [, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-full flex-col justify-between">
        <ul className="menu mt-6 md:mt-10">
          {menuItemsTop.map((item) => (
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
                title={item.label}
              >
                <i className="icon text-gray-500">{item.icon}</i>
                <span className="text whitespace-nowrap transition duration-200 ease-linear">
                  {item.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
        <ul className="menu pt-6 md:mt-10">
          {menuItemsBottom.map((item) => (
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
          <li key={"support"}>
            <CrispButton
              className={tw(
                "my-1 flex items-center justify-start gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-gray-100 hover:text-gray-900"
              )}
              variant="link"
              width="full"
              titke="Questions/Feedback"
            >
              <span className="flex items-center justify-start gap-3">
                <i className="icon text-gray-500">
                  <QuestionsIcon />
                </i>
                <span className="text whitespace-nowrap transition duration-200 ease-linear">
                  Questions/Feedback
                </span>
              </span>
            </CrispButton>
          </li>
        </ul>
      </div>
      <ChatWithAnExpert />
    </div>
  );
};

export default MenuItems;
