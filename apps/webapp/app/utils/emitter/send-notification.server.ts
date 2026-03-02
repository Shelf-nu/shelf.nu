import type { NotificationType } from "~/atoms/notifications";
import { emitter } from "./emitter.server";
import { ShelfError } from "../error";

export function sendNotification(notification: Omit<NotificationType, "open">) {
  try {
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
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to send notification",
      additionalData: { notification },
      label: "Notification",
    });
  }
}
