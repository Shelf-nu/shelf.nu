import { BellIcon } from "lucide-react";
import { useLoaderData, useLocation } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { SidebarMenuButton, SidebarMenuItem } from "./sidebar";

export default function UpdatesNavItem() {
  const { unreadUpdatesCount } = useLoaderData<typeof loader>();
  const location = useLocation();
  const hasUnread = unreadUpdatesCount > 0;
  const isActive = location.pathname === "/updates";

  return (
    <SidebarMenuItem className="hidden md:block">
      <SidebarMenuButton
        asChild
        className={tw(
          "font-semibold",
          isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
        tooltip="Updates"
      >
        <a href="/updates">
          <div className="relative">
            <BellIcon className="size-4 text-gray-600" />
            {hasUnread && (
              <div
                className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full bg-blue-500"
                style={{ animationDuration: "1s" }}
              />
            )}
          </div>
          <span>Updates</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
