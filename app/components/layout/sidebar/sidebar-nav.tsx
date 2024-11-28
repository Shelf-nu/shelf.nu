import { ChevronDownIcon } from "@radix-ui/react-icons";
import { NavLink, useMatches } from "@remix-run/react";
import Icon from "~/components/icons/icon";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import type { NavItem } from "~/hooks/use-sidebar-nav-items";
import { tw } from "~/utils/tw";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./sidebar";

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
                defaultOpen={item.defaultOpen}
              >
                <SidebarMenuItem key={item.title}>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title}>
                      <Icon
                        size="xs"
                        icon={item.icon}
                        className="text-gray-600"
                      />
                      <span className="font-semibold">{item.title}</span>
                      <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
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
                                  "font-medium hover:bg-gray-100",
                                  isChildActive && "bg-gray-100"
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
                  className={tw("font-semibold", isActive && "bg-gray-100")}
                >
                  <Icon size="xs" icon={item.icon} className="text-gray-600" />
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
