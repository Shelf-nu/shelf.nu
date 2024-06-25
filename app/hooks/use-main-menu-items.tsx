import Icon from "~/components/icons/icon";
import { useUserData } from "./use-user-data";
import { useUserIsSelfService } from "./user-user-is-self-service";

export function useMainMenuItems() {
  const user = useUserData();

  let menuItemsTop = [
    {
      icon: <Icon icon="graph" />,
      to: "dashboard",
      title: "Dashboard",
    },
    {
      icon: <Icon icon="asset" />,
      to: "assets",
      title: "Assets",
    },
    {
      icon: <Icon icon="kit" />,
      to: "kits",
      title: "Kits",
    },
    {
      icon: <Icon icon="category" />,
      to: "categories",
      title: "Categories",
    },
    {
      icon: <Icon icon="tag" />,
      to: "tags",
      title: "Tags",
    },
    {
      icon: <Icon icon="location" />,
      to: "locations",
      title: "Locations",
    },
    {
      icon: <Icon icon="calendar" />,
      to: "calendar",
      title: "Calendar",
    },
    {
      icon: <Icon icon="bookings" />,
      to: "bookings",
      title: "Bookings",
    },
    {
      icon: <Icon icon="bookings" />,
      to: `https://www.shelf.nu/order-tags`,
      title: "Asset labels",
      target: "_blank",
    },
  ];
  let menuItemsBottom = [
    {
      icon: <Icon icon="scanQR" />,
      to: "scanner",
      title: "QR scanner",
      end: true,
    },
    {
      icon: <Icon icon="settings" />,
      to: "settings",
      title: "Workspace settings",
      end: true,
    },
  ];

  if (useUserIsSelfService()) {
    /** Deleting the Dashboard menu item as its not needed for self_service users. */
    const itemsToRemove = [
      "dashboard",
      "categories",
      "tags",
      "locations",
      "settings",
    ];
    menuItemsTop = menuItemsTop.filter(
      (item) => !itemsToRemove.includes(item.to)
    );
    menuItemsBottom = menuItemsBottom.filter(
      (item) => !itemsToRemove.includes(item.to)
    );
  }

  return {
    menuItemsTop,
    menuItemsBottom,
  };
}
