import { ChevronRight, HomeIcon } from "~/components/icons/library";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import { matchRoutes, NavLink, useMatch, useMatches } from "@remix-run/react";
import { NavItem, useSidebarNavItems } from "~/hooks/use-sidebar-nav-items";
import Icon from "~/components/icons/icon";
import { tw } from "~/utils/tw";

type SidebarNavProps = {
  className?: string;
  style?: React.CSSProperties;
  items: NavItem[];
};

export default function SidebarNav({
  className,
  style,
  items,
}: SidebarNavProps) {
  const matches = useMatches();

  function isRouteActive(route: string) {
    const matchesRoutes = matches.map((match) => match.pathname);
    return matchesRoutes.some((matchRoute) => matchRoute.includes(route));
  }

  return (
    <SidebarGroup className={className} style={style}>
      <SidebarMenu>
        {items.map((item) => {
          if (item.type === "parent") {
            return (
              <Collapsible
                key={item.title}
                asChild
                className="group/collapsible"
              >
                <SidebarMenuItem key={item.title}>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title}>
                      <Icon
                        size="xs"
                        icon={item.icon}
                        className="text-gray-500"
                      />
                      <span>{item.title}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.children.map((child) => {
                        const isChildActive = isRouteActive(child.to);

                        return (
                          <SidebarMenuSubItem key={child.title}>
                            <SidebarMenuSubButton asChild>
                              <NavLink
                                to={child.to}
                                target={child.target}
                                className={tw(
                                  "font-medium",
                                  isChildActive &&
                                    "text-primary-500 bg-primary-25"
                                )}
                              >
                                {child.title}
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          }

          const isActive = isRouteActive(item.to);

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title}>
                <NavLink
                  to={item.to}
                  target={item.target}
                  className={tw(
                    "font-medium",
                    isActive && "text-primary-500 bg-primary-25"
                  )}
                >
                  <Icon size="xs" icon={item.icon} className="text-gray-500" />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
