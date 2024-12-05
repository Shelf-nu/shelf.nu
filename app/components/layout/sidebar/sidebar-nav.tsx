import { Fragment, useCallback } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  NavLink,
  useLocation,
  useMatches,
  useNavigate,
} from "@remix-run/react";
import invariant from "tiny-invariant";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import When from "~/components/when/when";
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
  useSidebar,
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
  const { isMobile, toggleSidebar, open } = useSidebar();
  const matches = useMatches();
  const navigate = useNavigate();
  const location = useLocation();
  const currentRoute = matches.at(-1);
  // @ts-expect-error
  const handle = currentRoute?.handle?.name;

  const isRouteActive = useCallback(
    (route: string) =>
      location.pathname.includes(route) && handle !== "$userId.bookings",
    [handle, location.pathname]
  );

  const isAnyRouteActive = useCallback(
    (routes: string[]) => routes.some(isRouteActive),
    [isRouteActive]
  );

  const renderTooltopContent = useCallback((navItem: NavItem) => {
    if (typeof navItem.disabled === "boolean" && navItem.disabled) {
      return `${navItem.title} is disabled`;
    }

    if (typeof navItem.disabled === "object") {
      return { children: navItem.disabled.reason };
    }

    return navItem.title;
  }, []);

  const closeIfMobile = useCallback(() => {
    if (isMobile) {
      toggleSidebar();
    }
  }, [isMobile, toggleSidebar]);

  const navigateParentNav = useCallback(
    (to: string) => {
      navigate(to);
      closeIfMobile();
    },
    [closeIfMobile, navigate]
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
              asChild
              className="group/collapsible"
              defaultOpen={isAnyChildActive && !navItem.disabled}
            >
              <SidebarMenuItem key={navItem.title} className="z-50">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    disabled={!!navItem.disabled}
                    tooltip={renderTooltopContent(navItem)}
                    onClick={() => {
                      /** Clicking on the parent item should navigate to the first item, if the menu is not open */
                      if (!open) {
                        navigateParentNav(firstChildRoute.to);
                      }
                    }}
                  >
                    <navItem.Icon
                      className={tw(
                        "size-4 text-gray-600",
                        !open && isAnyChildActive && "text-primary"
                      )}
                    />
                    <span className="font-semibold">{navItem.title}</span>
                    <ChevronDownIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <When truthy={!navItem.disabled}>
                      {navItem.children.map((child) => {
                        const isChildActive = isRouteActive(child.to);

                        return (
                          <SidebarMenuSubItem key={child.title}>
                            <SidebarMenuSubButton
                              onClick={closeIfMobile}
                              asChild
                            >
                              <NavLink
                                to={child.to}
                                target={child.target}
                                className={tw(
                                  "font-medium hover:bg-gray-100",
                                  isChildActive &&
                                    "bg-transparent font-bold !text-primary"
                                )}
                              >
                                {child.title}
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </When>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        }

        case "child": {
          const isActive = isRouteActive(navItem.to);

          return (
            <SidebarMenuItem className="z-50">
              <SidebarMenuButton
                asChild
                disabled={!!navItem.disabled}
                tooltip={renderTooltopContent(navItem)}
                onClick={closeIfMobile}
              >
                <NavLink
                  to={navItem.to}
                  target={navItem.target}
                  className={tw(
                    "font-semibold",
                    isActive ? "bg-transparent font-bold text-primary" : ""
                  )}
                >
                  <navItem.Icon
                    className={tw(
                      "size-4 text-gray-600",
                      isActive && "text-primary"
                    )}
                  />
                  <span>{navItem.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        case "label": {
          return (
            <SidebarGroupLabel
              className={
                navItem.title.toLowerCase() === "organization"
                  ? "mt-4"
                  : undefined
              }
            >
              {navItem.title}
            </SidebarGroupLabel>
          );
        }

        case "button": {
          return (
            <SidebarMenuItem onClick={navItem.onClick}>
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
    [
      closeIfMobile,
      isAnyRouteActive,
      isRouteActive,
      navigateParentNav,
      open,
      renderTooltopContent,
    ]
  );

  return (
    <SidebarGroup className={className} style={style}>
      <SidebarMenu>
        {items.map((navItem, i) => (
          <Fragment key={i}>{renderNavItem(navItem)}</Fragment>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
