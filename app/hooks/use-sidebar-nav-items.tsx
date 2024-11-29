import { Crisp } from "crisp-sdk-web";
import type { IconType } from "~/components/shared/icons-map";
import { useUserRoleHelper } from "./user-user-role-helper";

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

type LabelNavItem = Omit<BaseNavItem, "icon"> & {
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
      type: "label",
      title: "Organization",
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

  const bottomMenuItems: NavItem[] = [
    {
      type: "child",
      title: "Asset labels",
      to: `https://store.shelf.nu/?ref=shelf_webapp_sidebar`,
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
      type: "button",
      title: "Questions/Feedback",
      icon: "question",
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
