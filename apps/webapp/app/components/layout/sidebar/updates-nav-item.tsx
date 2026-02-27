import { BellIcon } from "lucide-react";
import { NavLink, useLoaderData } from "react-router";
import { useIsRouteActive } from "~/hooks/use-is-route-active";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { SidebarMenuButton, SidebarMenuItem } from "./sidebar";

export default function UpdatesNavItem() {
  const { unreadUpdatesCount } = useLoaderData<typeof loader>();
  const hasUnread = unreadUpdatesCount > 0;
  const isActive = useIsRouteActive("/updates");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Updates">
        <NavLink
          to="/updates"
          className={tw(
            "font-semibold",
            isActive ? "bg-transparent font-bold text-primary" : ""
          )}
        >
          <div className="relative">
            <BellIcon
              className={tw(
                "size-4 text-color-600",
                isActive && "text-primary"
              )}
            />
            {hasUnread && (
              <div
                className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full bg-blue-500"
                style={{ animationDuration: "1s" }}
              />
            )}
          </div>
          <span>Updates</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
