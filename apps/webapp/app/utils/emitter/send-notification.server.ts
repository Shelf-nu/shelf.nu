/**
 * Toast notification sender
 *
 * Serializes a toast and hands it to the notification bus, which delivers it
 * to the SSE streams of every machine (see `notification-bus.server.ts`). The
 * SSE route then filters by sender and originating tab.
 *
 * @see {@link file://./notification-bus.server.ts}
 * @see {@link file://./../../routes/api+/sse.notification.ts}
 */
import type { NotificationType } from "~/atoms/notifications";
import { publishNotification } from "./notification-bus.server";
import { ShelfError } from "../error";
import { getTabId } from "../tab-id.server";

/**
 * Sends a toast to the browser of `notification.senderId`.
 *
 * @param notification - The toast content; `open`, `tabId` and `time` are added here
 * @throws {ShelfError} If the notification cannot be serialized or published
 */
export function sendNotification(notification: Omit<NotificationType, "open">) {
  try {
    publishNotification(
      JSON.stringify({
        ...notification,
        open: true,
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
