import type { User } from "@prisma/client";
import { atom } from "jotai";
import type { IconType } from "~/components/shared/icons-map";

export type NotificationVariant = "primary" | "gray" | "success" | "error";
export type NotificationIcon = {
  name: IconType;
  variant: NotificationVariant;
  className?: string;
};

export interface NotificationType {
  open: boolean;
  title: string;
  message?: string | null;
  icon: NotificationIcon;
  time?: number;
  senderId: User["id"] | null;
  tabId?: string;
}

export const notificationAtom = atom<NotificationType>({
  open: false,
  title: "",
  message: "",
  icon: {
    name: "plus",
    variant: "gray",
    className: "",
  },
  senderId: null,
});

/** Opens the Toast and shows the notification */
export const showNotificationAtom = atom(
  (get) => get(notificationAtom),
  (_get, set, notification: Omit<NotificationType, "open">) =>
    set(notificationAtom, () => ({
      ...notification,
      open: true,
    }))
);

/** Opens the Toast and shows the notification */
export const clearNotificationAtom = atom(
  (get) => get(notificationAtom),
  (_get, set) =>
    set(notificationAtom, (prev) => ({
      ...prev,
      open: false,
    }))
);
