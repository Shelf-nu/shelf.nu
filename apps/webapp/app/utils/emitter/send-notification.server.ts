import type { NotificationType } from "~/atoms/notifications";
import { emitter } from "./emitter.server";
import { ShelfError } from "../error";
import { getTabId } from "../tab-id.server";

export function sendNotification(notification: Omit<NotificationType, "open">) {
  try {
    emitter.emit(
      "notification",
      JSON.stringify({
        ...notification,
        open: true,
        /** Identifies the browser tab that triggered this notification.
         * When present, the SSE handler delivers the toast only to that tab.
         * Background jobs run outside a request context so tabId is undefined,
         * causing the notification to be broadcast to all tabs. */
        tabId: getTabId(),
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
