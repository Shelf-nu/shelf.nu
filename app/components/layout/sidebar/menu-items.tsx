import type { FetcherWithComponents } from "@remix-run/react";
import { NavLink, useLoaderData, useLocation } from "@remix-run/react";
import { motion } from "framer-motion";
import { useAtom } from "jotai";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import Icon from "~/components/icons/icon";
import { ControlledActionButton } from "~/components/shared/controlled-action-button";
import When from "~/components/when/when";
import { useMainMenuItems } from "~/hooks/use-main-menu-items";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { toggleMobileNavAtom } from "./atoms";
import { ChatWithAnExpert } from "./chat-with-an-expert";

const MenuItems = ({ fetcher }: { fetcher: FetcherWithComponents<any> }) => {
  const [, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  const { isAdmin, minimizedSidebar, canUseBookings } =
    useLoaderData<typeof loader>();
  const { menuItemsTop, menuItemsBottom } = useMainMenuItems();
  const location = useLocation();
  const [workspaceSwitching] = useAtom(switchingWorkspaceAtom);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-full flex-col justify-between">
        <ul className="menu">
          {isAdmin ? (
            <li>
              <NavLink
                className={({ isActive }) =>
                  tw(
                    "my-1 flex items-center gap-3 rounded px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                    isActive ? "active bg-primary-50 text-primary-600" : "",
                    workspaceSwitching ? "pointer-events-none" : ""
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
            item.to === "bookings" || item.to === "calendar" ? (
              <li key={item.title}>
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
                          {item.title}
                        </span>
                      </span>
                    ),
                    message: `${
                      item.to[0].toUpperCase() + item.to.substring(1)
                    } is a premium feature only available for Team workspaces.`,
                    ctaText: "upgrading to a team plan",
                  }}
                  buttonProps={{
                    to: item.to,
                    "data-test-id": `${item.title.toLowerCase()}SidebarMenuItem`,
                    onClick: toggleMobileNav,
                    title: item.title,
                    disabled: workspaceSwitching,
                    className: tw(
                      "my-1 flex items-center gap-3 rounded border-0 bg-transparent px-3 text-left text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                      canUseBookings
                        ? "justify-start focus:ring-0"
                        : "my-0 text-gray-500 hover:bg-gray-50 hover:text-gray-500",
                      /** We need to do this becasue of a special way we handle the bookings link that doesnt allow us to use NavLink currently */
                      location.pathname.includes(item.to) &&
                        !location.pathname.includes("assets")
                        ? "active bg-primary-50 text-primary-600"
                        : ""
                    ),
                  }}
                />
              </li>
            ) : (
              <li key={item.title}>
                <NavLink
                  className={({ isActive }) =>
                    tw(
                      "my-1 flex items-center gap-3 rounded px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                      isActive ? "active bg-primary-50 text-primary-600" : "",
                      workspaceSwitching ? "pointer-events-none" : ""
                    )
                  }
                  to={item.to}
                  data-test-id={`${item.title.toLowerCase()}SidebarMenuItem`}
                  onClick={toggleMobileNav}
                  title={item.title}
                >
                  <i className="icon inline-flex pl-[2px] text-gray-500">
                    {item.icon}
                  </i>
                  <span className="text whitespace-nowrap transition duration-200 ease-linear">
                    {item.title}
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
              <li key={item.title}>
                <NavLink
                  className={({ isActive }) =>
                    tw(
                      " my-1 flex items-center  gap-3 rounded px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                      isActive ? "active bg-primary-50 text-primary-600" : "",
                      workspaceSwitching ? "pointer-events-none" : ""
                    )
                  }
                  to={item.to}
                  data-test-id={`${item.title.toLowerCase()}SidebarMenuItem`}
                  onClick={toggleMobileNav}
                  title={item.title}
                  target={item?.target || undefined}
                >
                  <i className="icon inline-flex pl-[2px] text-gray-500">
                    {item.icon}
                  </i>
                  <span className="text whitespace-nowrap transition duration-200 ease-linear">
                    {item.title}
                  </span>
                  <When truthy={item.isNew || false}>
                    <span className="ml-auto rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-600">
                      New
                    </span>
                  </When>
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
                    "crisp-btn mt-1 flex w-full items-center gap-3 rounded px-3 py-2.5 text-[16px] font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600",
                    workspaceSwitching ? "pointer-events-none" : ""
                  )}
                >
                  <i className="icon inline-flex pl-[2px] text-gray-500">
                    <Icon icon="switch" />
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
