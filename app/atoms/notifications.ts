import { atom } from "jotai";
import type { Icon } from "~/components/shared/icons-map";

export interface NotificationType {
  open: boolean;
  title: string;
  message: string;
  icon: {
    name: Icon;
    variant: "primary" | "gray" | "success" | "error";
    className?: string;
  };
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
});

/** Opens the Toast and shows the notification */
export const showNotificationAtom = atom(
  (get) => get(notificationAtom),
  (_get, set, { title, message, icon }: Omit<NotificationType, "open">) =>
    set(notificationAtom, (prev) => ({
      open: true,
      title,
      message,
      icon: {
        ...prev.icon,
        ...icon,
      },
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
