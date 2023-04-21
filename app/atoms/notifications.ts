import { atom } from "jotai";

export const notificationAtom = atom({
  open: false,
  title: "",
  message: "",
  icon: "",
});

/** Opens the Toast and shows the notification */
export const showNotificationAtom = atom(
  (get) => get(notificationAtom),
  (
    _get,
    set,
    { title, message, icon }: { title: string; message: string; icon?: string }
  ) =>
    set(notificationAtom, () => ({
      open: true,
      title,
      message,
      icon: icon || "",
    }))
);

/** Opens the Toast and shows the notification */
export const clearNotificationAtom = atom(
  (get) => get(notificationAtom),
  (_get, set) =>
    set(notificationAtom, () => ({
      open: false,
      title: "",
      message: "",
      icon: "",
    }))
);
