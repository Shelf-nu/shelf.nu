import { Crisp } from "crisp-sdk-web";
import {
  BoxesIcon,
  BriefcaseConveyorBeltIcon,
  CalendarRangeIcon,
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
import { useUserRoleHelper } from "./user-user-role-helper";

type BaseNavItem = {
  title: string;
  hidden?: boolean;
  Icon: LucideIcon;
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
  const { isBaseOrSelfService } = useUserRoleHelper();

  const topMenuItems: NavItem[] = [
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
      children: [
        {
          title: "View Bookings",
          to: "/bookings",
        },
        {
          title: "Calendar",
          to: "/calendar",
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
