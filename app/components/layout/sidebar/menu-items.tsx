import type { FetcherWithComponents } from "@remix-run/react";
import { NavLink, useLoaderData, useLocation } from "@remix-run/react";
import { motion } from "framer-motion";
import { useAtom } from "jotai";
import { SwitchIcon } from "~/components/icons/library";
import { ControlledActionButton } from "~/components/shared/controlled-action-button";
import { useMainMenuItems } from "~/hooks/use-main-menu-items";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils";
import { toggleMobileNavAtom } from "./atoms";
import { ChatWithAnExpert } from "./chat-with-an-expert";

const MenuItems = ({ fetcher }: { fetcher: FetcherWithComponents<any> }) => {
  const [, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  const { isAdmin, minimizedSidebar, canUseBookings } =
    useLoaderData<typeof loader>();
  const { menuItemsTop, menuItemsBottom } = useMainMenuItems();
  const location = useLocation();
  /** We need to do this becasue of a special way we handle the bookings link that doesnt allow us to use NavLink currently */
  const isBookingsRoute = location.pathname.includes("/bookings");

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

          {menuItemsTop.map((item) =>
            item.to === "bookings" ? (
              <li key={item.label}>
                <ControlledActionButton
                  canUseFeature={canUseBookings}
                  buttonContent={{
                    title: (
                      <span className="flex items-center gap-3 rounded ">
                        <i
                          className={tw(
                            "icon pl-[2px] text-gray-500",
                            !canUseBookings
                              ? "!hover:text-gray-500 !text-gray-500"
                              : ""
                          )}
                        >
                          {item.icon}
                        </i>
                        <span className="text whitespace-nowrap transition duration-200 ease-linear hover:text-primary-600">
                          {item.label}
                        </span>
                      </span>
                    ),
                    message:
                      "Bookings is a premium feature only available for Team workspaces. ",
                    ctaText: "upgrading to a team plan",
                  }}
                  buttonProps={{
                    to: item.to,
                    "data-test-id": `${item.label.toLowerCase()}SidebarMenuItem`,
                    onClick: toggleMobileNav,
                    title: item.label,
                    className: tw(
                      "my-1 flex items-center gap-3 rounded-md border-0 bg-transparent px-3 text-left text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                      canUseBookings
                        ? "justify-start focus:ring-0"
                        : "my-0 text-gray-500 hover:bg-gray-50 hover:text-gray-500",
                      isBookingsRoute
                        ? "active bg-primary-50 text-primary-600"
                        : ""
                    ),
                  }}
                />
              </li>
            ) : (
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
                  <i className="icon pl-[2px] text-gray-500">{item.icon}</i>
                  <span className="text whitespace-nowrap transition duration-200 ease-linear">
                    {item.label}
                  </span>
                </NavLink>
              </li>
            )
          )}
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
                  <i className="icon pl-[2px] text-gray-500">{item.icon}</i>
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
                  <i className="icon pl-[2px] text-gray-500">
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
