import {
  AssetsIcon,
  CalendarIcon,
  CategoriesIcon,
  GraphIcon,
  LocationMarkerIcon,
  SettingsIcon,
  TagsIcon,
} from "~/components/icons";
// eslint-disable-next-line import/no-cycle
import { useUserIsSelfService } from "./user-user-is-self-service";

export function useMainMenuItems() {
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
      label: "Bookings (beta)",
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

  if (useUserIsSelfService()) {
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
