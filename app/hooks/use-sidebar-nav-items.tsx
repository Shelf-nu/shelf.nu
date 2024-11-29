import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import { Crisp } from "crisp-sdk-web";
import {
  BoxesIcon,
  BriefcaseConveyorBeltIcon,
  CalendarRangeIcon,
  ChartLineIcon,
  ChartNoAxesCombinedIcon,
  MapPinIcon,
  MessageCircleIcon,
  PackageOpenIcon,
  QrCodeIcon,
  ScanQrCodeIcon,
  SettingsIcon,
  TagsIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import When from "~/components/when/when";
import type { loader } from "~/routes/_layout+/_layout";
import { useUserRoleHelper } from "./user-user-role-helper";

type BaseNavItem = {
  title: string;
  hidden?: boolean;
  Icon: LucideIcon;
  disabled?: boolean | { reason: React.ReactNode };
};

type ChildNavItem = BaseNavItem & {
  type: "child";
  to: string;
  target?: string;
};

type ParentNavItem = BaseNavItem & {
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

export function useSidebarNavItems() {
  const { isAdmin, canUseBookings, subscription } =
    useLoaderData<typeof loader>();
  const { isBaseOrSelfService } = useUserRoleHelper();

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

  const topMenuItems: NavItem[] = [
    {
      type: "label",
      title: "Admin",
      hidden: !isAdmin,
    },
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
      title: "Dashboard",
      to: "/dashboard",
      Icon: ChartNoAxesCombinedIcon,
      hidden: isBaseOrSelfService,
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
      Icon: BriefcaseConveyorBeltIcon,
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Categories",
      to: "/categories",
      Icon: BoxesIcon,
      hidden: isBaseOrSelfService,
    },

    {
      type: "child",
      title: "Tags",
      to: "/tags",
      Icon: TagsIcon,
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Locations",
      to: "/locations",
      Icon: MapPinIcon,
      hidden: isBaseOrSelfService,
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
      type: "label",
      title: "Organization",
    },
    {
      type: "parent",
      title: "Team",
      Icon: UsersRoundIcon,
      hidden: isBaseOrSelfService,
      children: [
        {
          title: "Users",
          to: "/settings/team/users",
        },
        {
          title: "Non-registered members",
          to: "/settings/team/nrm",
        },
      ],
    },
    {
      type: "parent",
      title: "Workspace settings",
      Icon: SettingsIcon,
      hidden: isBaseOrSelfService,
      children: [
        {
          title: "General",
          to: "/settings/general",
        },
        {
          title: "Custom fields",
          to: "/settings/custom-fields",
        },
        {
          title: "Team",
          to: "/settings/team",
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
      Icon: ScanQrCodeIcon,
    },
    {
      type: "button",
      title: "Questions/Feedback",
      Icon: MessageCircleIcon,
      onClick: () => {
        Crisp.chat.open();
      },
    },
  ];

  return {
    topMenuItems: topMenuItems.filter((item) => !item.hidden),
    bottomMenuItems: bottomMenuItems.filter((item) => !item.hidden),
  };
}
