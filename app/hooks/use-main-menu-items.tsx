import Icon from "~/components/icons/icon";
// eslint-disable-next-line import/no-cycle
import { useUserIsSelfService } from "./user-user-is-self-service";

export function useMainMenuItems() {
  let menuItemsTop = [
    {
      icon: <Icon icon="graph" />,
      to: "dashboard",
      label: "Dashboard",
    },
    {
      icon: <Icon icon="asset" />,
      to: "assets",
      label: "Assets",
    },
    {
      icon: <Icon icon="category" />,
      to: "categories",
      label: "Categories",
    },
    {
      icon: <Icon icon="tag" />,
      to: "tags",
      label: "Tags",
    },
    {
      icon: <Icon icon="location" />,
      to: "locations",
      label: "Locations",
    },
    {
      icon: <Icon icon="calendar" />,
      to: "calendar",
      label: "Calendar",
    },
    {
      icon: <Icon icon="bookings" />,
      to: "bookings",
      label: "Bookings (beta)",
    },
  ];
  const menuItemsBottom = [
    {
      icon: <Icon icon="scanQR" />,
      to: "scanner",
      label: "QR scanner",
      end: true,
    },
    {
      icon: <Icon icon="settings" />,
      to: "settings",
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
