import { useUserData } from "./use-user-data";
import { useUserRoleHelper } from "./user-user-role-helper";
import { IconType } from "~/components/shared/icons-map";

type BaseNavItem = {
  title: string;
  hidden?: boolean;
  icon: IconType;
};

type ChildNavItem = BaseNavItem & {
  type: "child";
  to: string;
  target?: string;
};

type ParentNavItem = BaseNavItem & {
  type: "parent";
  children: Omit<ChildNavItem, "type" | "icon">[];
};

export type NavItem = ChildNavItem | ParentNavItem;

export function useSidebarNavItems() {
  const user = useUserData();
  const { isBaseOrSelfService } = useUserRoleHelper();

  const topMenuItems: NavItem[] = [
    {
      type: "child",
      title: "Dashboard",
      to: "/dashboard",
      icon: "graph",
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Assets",
      to: "/assets",
      icon: "asset",
    },
    {
      type: "child",
      title: "Kits",
      to: "/kits",
      icon: "kit",
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Categories",
      to: "/categories",
      icon: "category",
      hidden: isBaseOrSelfService,
    },

    {
      type: "child",
      title: "Tags",
      to: "/tags",
      icon: "tag",
      hidden: isBaseOrSelfService,
    },
    {
      type: "child",
      title: "Locations",
      to: "/locations",
      icon: "location",
      hidden: isBaseOrSelfService,
    },
    {
      type: "parent",
      title: "Bookings",
      icon: "bookings",
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
      type: "parent",
      title: "Team",
      icon: "user",
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
  ];

  const bottomMenuItems: NavItem[] = [
    {
      type: "child",
      title: "Asset labels",
      to: `https://www.shelf.nu/order-tags?email=${user?.email}${
        user?.firstName ? `&firstName=${user.firstName}` : ""
      }${user?.lastName ? `&lastName=${user.lastName}` : ""}`,
      icon: "asset-label",
      target: "_blank",
    },
    {
      type: "child",
      title: "QR Scanner",
      to: "/scanner",
      icon: "scanQR",
    },
    {
      type: "parent",
      title: "Workspace settings",
      icon: "settings",
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

  return {
    topMenuItems: topMenuItems.filter((item) => !item.hidden),
    bottomMenuItems: bottomMenuItems.filter((item) => !item.hidden),
  };
}
