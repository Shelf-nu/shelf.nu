import type { ComponentProps } from "react";
import { ChevronDownIcon } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
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
  ParentNavItem as ParentNavItemType,
} from "~/hooks/use-sidebar-nav-items";
import { BADGE_COLORS } from "~/utils/badge-colors";
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
  route: ParentNavItemType;
  tooltip: ComponentProps<typeof SidebarMenuButton>["tooltip"];
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
        void navigate(firstChildRoute.to);
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

  /**
   * Disabled children (e.g. "Users" / "Pending invites" on a Personal
   * workspace) stay visible but render muted and non-navigating, with the
   * reason shown as a hover tooltip. This mirrors how disabled features are
   * surfaced elsewhere instead of hiding the capability outright.
   */
  if (nested.disabled) {
    const reason =
      typeof nested.disabled === "object" ? nested.disabled.reason : undefined;
    return (
      <SidebarMenuSubItem key={nested.title}>
        <SidebarMenuSubButton asChild>
          <span
            title={typeof reason === "string" ? reason : undefined}
            className="cursor-not-allowed font-medium !text-gray-400"
          >
            {nested.title}
          </span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

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
          <span className="flex w-full items-center justify-between gap-2">
            {nested.title}
            {nested.badge?.show && nested.badge.count ? (
              <span
                aria-label={`${nested.badge.count} waiting`}
                className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                style={{
                  backgroundColor: BADGE_COLORS.orange.bg,
                  color: BADGE_COLORS.orange.text,
                }}
              >
                {nested.badge.count}
              </span>
            ) : null}
          </span>
        </NavLink>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
