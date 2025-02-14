import { NavLink, useNavigate } from "@remix-run/react";
import { ChevronDownIcon } from "lucide-react";
import invariant from "tiny-invariant";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import When from "~/components/when/when";
import {
  useIsAnyRouteActive,
  useIsRouteActive,
} from "~/hooks/use-is-route-active";
import type {
  ChildNavItem,
  ParentNavItem,
} from "~/hooks/use-sidebar-nav-items";
import { tw } from "~/utils/tw";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "./sidebar";

type ParentNavItemProps = {
  route: ParentNavItem;
  tooltip: React.ComponentProps<typeof SidebarMenuButton>["tooltip"];
  closeIfMobile?: () => void;
};

export default function ParentNavItem({
  route,
  tooltip,
  closeIfMobile,
}: ParentNavItemProps) {
  const { state, isMobile } = useSidebar();
  const navigate = useNavigate();
  const isAnyChildActive = useIsAnyRouteActive(
    route.children.map((child) => child.to)
  );

  const firstChildRoute = route.children[0];
  invariant(
    typeof firstChildRoute !== "undefined",
    "'parent' nav item should have at leaset one child route"
  );

  function handleClick() {
    if (!isMobile) {
      if (state === "collapsed") {
        navigate(firstChildRoute.to);
      }
      closeIfMobile && closeIfMobile();
    }
  }

  return (
    <Collapsible
      asChild
      className="group/collapsible"
      defaultOpen={isAnyChildActive && !route.disabled}
    >
      <SidebarMenuItem key={route.title} className="z-50">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            disabled={!!route.disabled}
            tooltip={tooltip}
            onClick={handleClick}
          >
            <route.Icon className="size-4 text-gray-600" />
            <span className="font-semibold">{route.title}</span>
            <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <When truthy={!route.disabled}>
              {route.children.map((child) => (
                <NestedRouteRenderer
                  key={child.to}
                  nested={child}
                  closeIfMobile={closeIfMobile}
                />
              ))}
            </When>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function NestedRouteRenderer({
  nested,
  closeIfMobile,
}: {
  nested: Omit<ChildNavItem, "type" | "Icon">;
  closeIfMobile?: () => void;
}) {
  const isChildActive = useIsRouteActive(nested.to);

  return (
    <SidebarMenuSubItem key={nested.title}>
      <SidebarMenuSubButton onClick={closeIfMobile} asChild>
        <NavLink
          to={nested.to}
          target={nested.target}
          className={tw(
            "font-medium hover:bg-gray-100",
            isChildActive && "bg-transparent font-bold !text-primary"
          )}
        >
          {nested.title}
        </NavLink>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
