import { ShelfSidebarLogo } from "~/components/marketing/logos";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "./sidebar";
import OrganizationSelector from "./organization-selector";
import SidebarUserMenu from "./sidebar-user-menu";
import SidebarNav from "./sidebar-nav";

type AppSidebarProps = React.ComponentProps<typeof Sidebar>;

export default function AppSidebar(props: AppSidebarProps) {
  const { state } = useSidebar();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className={state === "collapsed" ? "p-0" : ""}>
        <div className="flex items-center mt-2 mb-2">
          <ShelfSidebarLogo minimized={state === "collapsed"} />
        </div>

        <OrganizationSelector />
      </SidebarHeader>

      <SidebarContent>
        <SidebarNav />
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
