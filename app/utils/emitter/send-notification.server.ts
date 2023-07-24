import type { NotificationType } from "~/atoms/notifications";
import { emitter } from "./emitter.server";
// import { useUserData } from "~/hooks";

export function sendNotification(
  notification: Omit<NotificationType, "open">
): void {
  emitter.emit(
    "notification",
    JSON.stringify({
      ...notification,
      open: true,
      /** In the case when the user updates an item 2 times in a row for example, the notification will be the same so useEventStream wont react to the changes as its cached.
       * We send the time to make sure it always updates */
      time: Date.now(),
    })
  );
}
