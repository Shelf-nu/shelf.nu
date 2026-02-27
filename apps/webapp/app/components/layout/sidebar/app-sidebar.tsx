import type { ComponentProps } from "react";
import { ThemeToggle } from "~/components/dev/theme-toggle";
import { ShelfSidebarLogo } from "~/components/marketing/logos";
import { useSidebarNavItems } from "~/hooks/use-sidebar-nav-items";
import OrganizationSelector from "./organization-selector";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "./sidebar";
import SidebarNav from "./sidebar-nav";
import SidebarUserMenu from "./sidebar-user-menu";

type AppSidebarProps = ComponentProps<typeof Sidebar>;

export default function AppSidebar(props: AppSidebarProps) {
  const { state } = useSidebar();
  const { topMenuItems, bottomMenuItems } = useSidebarNavItems();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className={state === "collapsed" ? "px-0" : ""}>
        <div className="my-2 flex items-center">
          <ShelfSidebarLogo minimized={state === "collapsed"} />
        </div>

        <OrganizationSelector />
      </SidebarHeader>

      <SidebarContent>
        <SidebarNav items={topMenuItems} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarNav className="p-0" items={bottomMenuItems} />
        <ThemeToggle />
        <SidebarUserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
