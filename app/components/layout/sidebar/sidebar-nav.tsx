import { Fragment, useCallback } from "react";
import type { NavItem } from "~/hooks/use-sidebar-nav-items";
import ChildNavItem from "./child-nav-item";
import ParentNavItem from "./parent-nav-item";
import UpdatesNavItem from "./updates-nav-item";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
  const { isMobile, toggleSidebar } = useSidebar();

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

  const renderNavItem = useCallback(
    (navItem: NavItem) => {
      switch (navItem.type) {
        case "parent": {
          return (
            <ParentNavItem
              route={navItem}
              tooltip={renderTooltopContent(navItem)}
              closeIfMobile={closeIfMobile}
            />
          );
        }

        case "child": {
          return (
            <ChildNavItem
              route={navItem}
              closeIfMobile={closeIfMobile}
              tooltip={renderTooltopContent(navItem)}
            />
          );
        }

        case "label": {
          return (
            <SidebarGroupLabel
              asChild
              className={
                navItem.title.toLowerCase() === "organization"
                  ? "mt-4"
                  : undefined
              }
            >
              <li>{navItem.title}</li>
            </SidebarGroupLabel>
          );
        }

        case "button": {
          // Special handling for Updates button
          if (navItem.title === "Updates") {
            return <UpdatesNavItem />;
          }

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
    [closeIfMobile, renderTooltopContent]
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
