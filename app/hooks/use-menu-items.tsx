import { OrganizationRoles, type $Enums } from "@prisma/client";
import {
  AssetsIcon,
  CalendarIcon,
  CategoriesIcon,
  GraphIcon,
  LocationMarkerIcon,
  SettingsIcon,
  TagsIcon,
} from "~/components/icons";

export function useMenuItems(roles: $Enums.OrganizationRoles[] | undefined) {
  let menuItemsTop = [
    {
      icon: <GraphIcon />,
      to: "dashboard",
      label: "Dashboard",
    },
    {
      icon: <AssetsIcon />,
      to: "assets",
      label: "Assets",
    },
    {
      icon: <CategoriesIcon />,
      to: "categories",
      label: "Categories",
    },
    {
      icon: <TagsIcon />,
      to: "tags",
      label: "Tags",
    },
    {
      icon: <LocationMarkerIcon />,
      to: "locations",
      label: "Locations",
    },
    {
      icon: <CalendarIcon />,
      to: "bookings",
      label: "Bookings",
    },
  ];
  const menuItemsBottom = [
    {
      icon: <SettingsIcon />,
      to: "settings/account",
      label: "Settings",
      end: true,
    },
  ];

  if (roles?.includes(OrganizationRoles.SELF_SERVICE)) {
    /** Deleting the Dashboard menu item as its not needed for self_service users. */
    const itemsToRemove = ["dashboard", "categories", "tags", "locations"];
    menuItemsTop = menuItemsTop.filter(
      (item) => !itemsToRemove.includes(item.to)
    );
  }

  return {
    menuItemsTop,
    menuItemsBottom,
  };
}
