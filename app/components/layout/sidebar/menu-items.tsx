import type { FetcherWithComponents } from "@remix-run/react";
import { NavLink, useLoaderData } from "@remix-run/react";
import { motion } from "framer-motion";
import { useAtom } from "jotai";
import {
  AssetsIcon,
  CategoriesIcon,
  GraphIcon,
  LocationMarkerIcon,
  QuestionsIcon,
  SettingsIcon,
  SwitchIcon,
  TagsIcon,
} from "~/components/icons/library";
import { CrispButton } from "~/components/marketing/crisp";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils";
import { toggleMobileNavAtom } from "./atoms";
import { ChatWithAnExpert } from "./chat-with-an-expert";

const menuItemsTop = [
  {
    icon: <GraphIcon />,
    to: "dashboard",
    label: "Dashboard",
  },
  {
    icon: <AssetsIcon />,
    to: "assets",
    label: "Assets",
  },
  {
    icon: <CategoriesIcon />,
    to: "categories",
    label: "Categories",
  },
  {
    icon: <TagsIcon />,
    to: "tags",
    label: "Tags",
  },
  {
    icon: <LocationMarkerIcon />,
    to: "locations",
    label: "Locations",
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

const MenuItems = ({ fetcher }: { fetcher: FetcherWithComponents<any> }) => {
  const [, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  const { isAdmin, minimizedSidebar } = useLoaderData<typeof loader>();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-full flex-col justify-between">
        <ul className="menu">
          {isAdmin ? (
            <li>
              <NavLink
                className={({ isActive }) =>
                  tw(
                    "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                    isActive ? "active bg-primary-50 text-primary-600" : ""
                  )
                }
                to={"/admin-dashboard/users"}
                onClick={toggleMobileNav}
                title={"Admin dashboard"}
              >
                <i className="icon text-gray-500">🛸</i>
                <span className="text whitespace-nowrap transition duration-200 ease-linear">
                  Admin dashboard
                </span>
              </NavLink>
              <hr />
            </li>
          ) : null}

          {menuItemsTop.map((item) => (
            <li key={item.label}>
              <NavLink
                className={({ isActive }) =>
                  tw(
                    "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                    isActive ? "active bg-primary-50 text-primary-600" : ""
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

        <div className="lower-menu">
          {/* ChatWithAnExpert component will be visible when uncollapsed sidebar is selected and hidden when minimizing sidebar form is processing */}
          {fetcher.state == "idle" ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <ChatWithAnExpert />
            </motion.div>
          ) : null}
          <ul className="menu mb-6">
            <li key={"support"}>
              <CrispButton
                className={tw(
                  "my-1 flex items-center justify-start gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600"
                )}
                variant="link"
                width="full"
                title="Questions/Feedback"
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
            {menuItemsBottom.map((item) => (
              <li key={item.label}>
                <NavLink
                  className={({ isActive }) =>
                    tw(
                      "my-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                      isActive ? "active bg-primary-50 text-primary-600" : ""
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
            <li>
              <fetcher.Form
                method="post"
                action="/api/user/prefs/minimized-sidebar"
              >
                <input
                  type="hidden"
                  name="minimizeSidebar"
                  value={minimizedSidebar ? "close" : "open"}
                />
                <button
                  type="submit"
                  className={tw(
                    "crisp-btn mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600"
                  )}
                >
                  <i className="icon text-gray-500">
                    <SwitchIcon />
                  </i>
                  <span className="text whitespace-nowrap transition duration-200 ease-linear">
                    Minimize
                  </span>
                </button>
              </fetcher.Form>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MenuItems;
