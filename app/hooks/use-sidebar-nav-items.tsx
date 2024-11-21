import { useUserData } from "./use-user-data";
import { useUserRoleHelper } from "./user-user-role-helper";
import { IconType } from "~/components/shared/icons-map";

type BaseNavItem = {
  title: string;
  icon: IconType;
  hidden?: boolean;
};

type ChildNavItem = BaseNavItem & {
  type: "child";
  to: string;
  target?: string;
};

type ParentNavItem = BaseNavItem & {
  type: "parent";
  children: Omit<ChildNavItem, "type">[];
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
      type: "child",
      title: "Calendar",
      to: "/calendar",
      icon: "calendar",
    },
    {
      type: "child",
      title: "Bookings",
      to: "/bookings",
      icon: "bookings",
    },
    {
      type: "child",
      title: "Team",
      to: "/settings/team",
      icon: "user",
      hidden: isBaseOrSelfService,
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
      type: "child",
      title: "Workspace settings",
      to: "/settings",
      icon: "settings",
      hidden: isBaseOrSelfService,
    },
  ];

  return {
    topMenuItems: topMenuItems.filter((item) => !item.hidden),
    bottomMenuItems: bottomMenuItems.filter((item) => !item.hidden),
  };
}
