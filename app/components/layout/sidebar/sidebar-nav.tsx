import { useCallback } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { NavLink, useMatches, useNavigate } from "@remix-run/react";
import invariant from "tiny-invariant";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import type { NavItem } from "~/hooks/use-sidebar-nav-items";
import { tw } from "~/utils/tw";
import {
  SidebarGroup,
  SidebarGroupLabel,
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
  const navigate = useNavigate();

  const isRouteActive = useCallback(
    (route: string) => {
      const matchesRoutes = matches.map((match) => match.pathname);
      return matchesRoutes.some((matchRoute) => matchRoute.includes(route));
    },
    [matches]
  );

  const isAnyRouteActive = useCallback(
    (routes: string[]) => routes.some(isRouteActive),
    [isRouteActive]
  );

  const renderNavItem = useCallback(
    (navItem: NavItem) => {
      switch (navItem.type) {
        case "parent": {
          const firstChildRoute = navItem.children[0];
          invariant(
            typeof firstChildRoute !== "undefined",
            "'parent' nav item should have at lease one child route"
          );

          const isAnyChildActive = isAnyRouteActive(
            navItem.children.map((child) => child.to)
          );

          return (
            <Collapsible
              key={navItem.title}
              asChild
              className="group/collapsible"
              defaultOpen={isAnyChildActive}
            >
              <SidebarMenuItem key={navItem.title}>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip={navItem.title}
                    onClick={() => {
                      navigate(firstChildRoute.to);
                    }}
                  >
                    <navItem.Icon className="size-4 text-gray-600" />
                    <span className="font-semibold">{navItem.title}</span>
                    <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {navItem.children.map((child) => {
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

        case "child": {
          const isActive = isRouteActive(navItem.to);

          return (
            <SidebarMenuItem key={navItem.title}>
              <SidebarMenuButton asChild tooltip={navItem.title}>
                <NavLink
                  to={navItem.to}
                  target={navItem.target}
                  className={tw("font-semibold", isActive && "bg-gray-100")}
                >
                  <navItem.Icon className="size-4 text-gray-600" />
                  <span>{navItem.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        case "label": {
          return (
            <SidebarGroupLabel key={navItem.title}>
              {navItem.title}
            </SidebarGroupLabel>
          );
        }

        case "button": {
          return (
            <SidebarMenuItem key={navItem.title} onClick={navItem.onClick}>
              <SidebarMenuButton
                className="font-semibold"
                tooltip={navItem.title}
              >
                <navItem.Icon className="size-4 text-gray-600" />
                <span>{navItem.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        default: {
          return null;
        }
      }
    },
    [isAnyRouteActive, isRouteActive, navigate]
  );

  return (
    <SidebarGroup className={className} style={style}>
      <SidebarMenu>{items.map(renderNavItem)}</SidebarMenu>
    </SidebarGroup>
  );
}
