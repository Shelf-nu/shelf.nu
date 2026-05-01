import { Fragment, useCallback } from "react";
import type { CSSProperties } from "react";
import FeedbackNavItem from "~/components/feedback/feedback-nav-item";
import type { NavItem } from "~/hooks/use-sidebar-nav-items";
import ChildNavItem from "./child-nav-item";
import ParentNavItem from "./parent-nav-item";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./sidebar";
import UpdatesNavItem from "./updates-nav-item";

type SidebarNavProps = {
  className?: string;
  style?: CSSProperties;
  items: NavItem[];
};

/**
 * Computes the tooltip value (string or tooltip config object) for a nav item
 * based on its disabled state.
 */
function getNavItemTooltip(navItem: NavItem) {
  if (typeof navItem.disabled === "boolean" && navItem.disabled) {
    return `${navItem.title} is disabled`;
  }

  if (typeof navItem.disabled === "object") {
    return { children: navItem.disabled.reason };
  }

  return navItem.title;
}

/**
 * Module-scope renderer for a single nav item. Extracted from SidebarNav so that
 * each entry creates a stable component instance (rather than an inline render
 * function), preventing unnecessary remounts and satisfying the
 * `no-render-in-render` diagnostic.
 */
function NavItemRenderer({
  navItem,
  closeIfMobile,
}: {
  navItem: NavItem;
  closeIfMobile: () => void;
}) {
  switch (navItem.type) {
    case "parent": {
      return (
        <ParentNavItem
          route={navItem}
          tooltip={getNavItemTooltip(navItem)}
          closeIfMobile={closeIfMobile}
        />
      );
    }

    case "child": {
      return (
        <ChildNavItem
          route={navItem}
          closeIfMobile={closeIfMobile}
          tooltip={getNavItemTooltip(navItem)}
        />
      );
    }

    case "label": {
      return (
        <SidebarMenuItem>
          <SidebarGroupLabel
            className={
              navItem.title.toLowerCase() === "organization"
                ? "mt-4"
                : undefined
            }
          >
            {navItem.title}
          </SidebarGroupLabel>
        </SidebarMenuItem>
      );
    }

    case "button": {
      // Special handling for Updates button
      if (navItem.title === "Updates") {
        return <UpdatesNavItem />;
      }

      // Special handling for Feedback button
      if (navItem.title === "Questions/Feedback") {
        return <FeedbackNavItem />;
      }

      return (
        <SidebarMenuItem onClick={navItem.onClick}>
          <SidebarMenuButton className="font-semibold" tooltip={navItem.title}>
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
}

export default function SidebarNav({
  className,
  style,
  items,
}: SidebarNavProps) {
  const { isMobile, toggleSidebar } = useSidebar();

  const closeIfMobile = useCallback(() => {
    if (isMobile) {
      toggleSidebar();
    }
  }, [isMobile, toggleSidebar]);

  return (
    <SidebarGroup className={className} style={style}>
      <SidebarMenu>
        {items.map((navItem) => (
          // Use title as a stable key. Titles are unique within a sidebar
          // section (the list is authored in use-sidebar-nav-items.tsx).
          <Fragment key={`${navItem.type}-${navItem.title}`}>
            <NavItemRenderer navItem={navItem} closeIfMobile={closeIfMobile} />
          </Fragment>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
