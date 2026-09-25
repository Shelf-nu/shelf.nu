import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AlarmClockIcon,
  BellIcon,
  BoxesIcon,
  CalendarRangeIcon,
  ChartLineIcon,
  ClipboardCheckIcon,
  FileBarChartIcon,
  HomeIcon,
  MapPinIcon,
  MessageCircleIcon,
  Package,
  PackageOpenIcon,
  QrCodeIcon,
  ScanBarcodeIcon,
  SettingsIcon,
  TagsIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useLoaderData } from "react-router";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import When from "~/components/when/when";
import type { loader } from "~/routes/_layout+/_layout";
import { isPersonalOrg } from "~/utils/organization";
import type { AdminArea } from "~/utils/permissions/admin-areas";
import { canSeeAdminArea } from "~/utils/permissions/admin-areas";
import {
  visibleSettingsTabs,
  visibleTeamTabs,
} from "~/utils/permissions/settings-tabs";
import { useCurrentOrganization } from "./use-current-organization";
import { useUserRoleHelper } from "./user-user-role-helper";

type BaseNavItem = {
  title: string;
  hidden?: boolean;
  Icon: LucideIcon;
  disabled?: boolean | { reason: ReactNode };
  badge?: {
    show: boolean;
    variant?: "unread";
  };
};

export type ChildNavItem = BaseNavItem & {
  type: "child";
  to: string;
  target?: string;
};

export type ParentNavItem = BaseNavItem & {
  type: "parent";
  children: Omit<ChildNavItem, "type" | "Icon">[];
};

type LabelNavItem = Omit<BaseNavItem, "Icon"> & {
  type: "label";
};

type ButtonNavItem = BaseNavItem & {
  type: "button";
  onClick: () => void;
};

export type NavItem =
  | ChildNavItem
  | ParentNavItem
  | LabelNavItem
  | ButtonNavItem;

/**
 * The sidebar's navigation items for the current member and workspace.
 * Admin areas, Team and Workspace settings show with the matrix grant of the
 * page they open (`admin-areas.ts`, `settings-tabs.ts`); hidden items are
 * removed before the lists are returned.
 *
 * @returns The top and bottom menu items, hidden entries already removed
 */
export function useSidebarNavItems() {
  const { isAdmin, canUseBookings, subscription, unreadUpdatesCount } =
    useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();
  const currentOrganization = useCurrentOrganization();
  const isPersonalOrganization = isPersonalOrg(currentOrganization);

  /** Each admin area shows with the matrix grant of the page it opens. */
  const can = (area: AdminArea) => canSeeAdminArea({ roles, area });
  const settingsTabs = visibleSettingsTabs({
    roles,
    isPersonalOrg: isPersonalOrganization,
  }).map((t) => t.to);
  // The Team entries are listed even in personal workspaces (disabled with an
  // upgrade reason), so their visibility ignores the personal-workspace rule.
  const teamTabsAnyWorkspace = visibleTeamTabs({
    roles,
    isPersonalOrg: false,
  }).map((t) => t.to);
  const showTeam = teamTabsAnyWorkspace.length > 0;
  const showWorkspaceSettings = settingsTabs.some((t) => t !== "team");

  const bookingDisabled = useMemo(() => {
    if (canUseBookings) {
      return false;
    }

    return {
      reason: (
        <div>
          <h5>Disabled</h5>
          <p>
            Booking is a premium feature only available for Team workspaces.
          </p>

          <When truthy={!!subscription} fallback={<UpgradeMessage />}>
            <p>Please switch to your team workspace to access this feature.</p>
          </When>
        </div>
      ),
    };
  }, [canUseBookings, subscription]);

  /**
   * Personal workspaces can't invite registered users. Rather than hide the
   * "Users" / "Pending invites" items, we show them disabled with an upgrade
   * reason, mirroring how bookings are surfaced on Personal workspaces.
   */
  const teamInviteDisabled = useMemo(() => {
    if (!isPersonalOrganization) {
      return false;
    }

    return { reason: "Inviting users is available on Team workspaces" };
  }, [isPersonalOrganization]);

  const topMenuItems: NavItem[] = [
    {
      type: "child",
      title: "Admin Dashboard",
      to: "/admin-dashboard/users",
      Icon: ChartLineIcon,
      hidden: !isAdmin,
    },
    {
      type: "label",
      title: "Asset management",
    },
    {
      type: "child",
      title: "Home",
      to: "/home",
      Icon: HomeIcon,
      hidden: !can("home"),
    },
    {
      type: "child",
      title: "Assets",
      to: "/assets",
      Icon: PackageOpenIcon,
    },
    {
      type: "child",
      title: "Kits",
      to: "/kits",
      Icon: Package,
    },
    {
      type: "child",
      title: "Categories",
      to: "/categories",
      Icon: BoxesIcon,
      hidden: !can("categories"),
    },
    {
      type: "child",
      title: "Tags",
      to: "/tags",
      Icon: TagsIcon,
      hidden: !can("tags"),
    },
    {
      type: "child",
      title: "Locations",
      to: "/locations",
      Icon: MapPinIcon,
      hidden: !can("locations"),
    },
    {
      type: "child",
      title: "Audits",
      to: "/audits",
      Icon: ClipboardCheckIcon,
      hidden: !can("audits"),
    },
    {
      type: "parent",
      title: "Bookings",
      Icon: CalendarRangeIcon,
      disabled: bookingDisabled,
      children: [
        {
          title: "View Bookings",
          to: "/bookings",
          disabled: bookingDisabled,
        },
        {
          title: "Calendar",
          to: "/calendar",
          disabled: bookingDisabled,
        },
      ],
    },
    {
      type: "child",
      title: "Reminders",
      Icon: AlarmClockIcon,
      hidden: !can("reminders"),
      to: "/reminders",
    },
    {
      type: "child",
      title: "Reports",
      Icon: FileBarChartIcon,
      hidden: !can("reports"),
      to: "/reports",
    },
    {
      type: "label",
      title: "Organization",
      hidden: !(showTeam || showWorkspaceSettings),
    },
    {
      type: "parent",
      title: "Team",
      Icon: UsersRoundIcon,
      hidden: !showTeam,
      children: [
        {
          title: "Users",
          to: "/settings/team/users",
          disabled: teamInviteDisabled,
          hidden: !teamTabsAnyWorkspace.includes("users"),
        },
        {
          title: "Pending invites",
          to: "/settings/team/invites",
          disabled: teamInviteDisabled,
          hidden: !teamTabsAnyWorkspace.includes("invites"),
        },
        {
          title: "Non-registered members",
          to: "/settings/team/nrm",
          hidden: !teamTabsAnyWorkspace.includes("nrm"),
        },
      ],
    },
    {
      type: "parent",
      title: "Workspace settings",
      Icon: SettingsIcon,
      hidden: !showWorkspaceSettings,
      children: [
        {
          title: "General",
          to: "/settings/general",
          hidden: !settingsTabs.includes("general"),
        },
        {
          title: "Bookings",
          to: "/settings/bookings",
          // Team-workspace only: the tab list already drops it in a personal one.
          hidden: !settingsTabs.includes("bookings"),
        },
        {
          title: "Custom fields",
          to: "/settings/custom-fields",
          hidden: !settingsTabs.includes("custom-fields"),
        },
        {
          title: "Asset models",
          to: "/settings/asset-models",
          hidden: !settingsTabs.includes("asset-models"),
        },
      ],
    },
  ];

  const bottomMenuItems: NavItem[] = [
    {
      type: "child",
      title: "Asset labels",
      to: `https://store.shelf.nu/?ref=shelf_webapp_sidebar`,
      Icon: QrCodeIcon,
      target: "_blank",
    },
    {
      type: "child",
      title: "QR Scanner",
      to: "/scanner",
      Icon: ScanBarcodeIcon,
    },
    {
      type: "button",
      title: "Updates",
      Icon: BellIcon,
      badge: {
        show: (unreadUpdatesCount || 0) > 0,
        variant: "unread" as const,
      },
      onClick: () => {
        // This will be handled by the sidebar component with popover
      },
    },
    {
      type: "button",
      title: "Questions/Feedback",
      Icon: MessageCircleIcon,
      onClick: () => {
        // Handled by FeedbackNavItem in sidebar-nav.tsx
      },
    },
  ];

  return {
    topMenuItems: removeHiddenNavItems(topMenuItems),
    bottomMenuItems: removeHiddenNavItems(bottomMenuItems),
  };
}

function removeHiddenNavItems(navItems: NavItem[]) {
  return navItems
    .filter((item) => !item.hidden)
    .map((item) => {
      if (item.type === "parent") {
        return {
          ...item,
          children: item.children.filter((child) => !child.hidden),
        };
      }

      return item;
    });
}
