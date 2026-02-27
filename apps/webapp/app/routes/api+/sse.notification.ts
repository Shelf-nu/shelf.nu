import type { LoaderFunctionArgs } from "react-router";
import { eventStream } from "remix-utils/sse/server";
import { emitter } from "~/utils/emitter/emitter.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

export function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const url = new URL(request.url);
  const connectionTabId = url.searchParams.get("tabId");

  return eventStream(request.signal, function setup(send) {
    /** Notification is a stringified json object with the shape {@link Notification} */
    function handle(notification: string) {
      const parsed = JSON.parse(notification);

      /** We only send the notification if the logged in userId is the same as the senderId.
       * We do this to prevent other users receiving notifications
       */
      if (authSession.userId !== parsed.senderId) {
        return;
      }

      /** If the notification carries a tabId (user-triggered action), only
       * deliver it to the SSE connection opened by that specific browser tab.
       * Notifications without a tabId (e.g. background jobs, reminders) are
       * broadcast to every tab of the user.
       * @see https://github.com/Shelf-nu/shelf.nu/issues/1000 */
      if (parsed.tabId && connectionTabId && parsed.tabId !== connectionTabId) {
        return;
      }

      try {
        send({ event: "new-notification", data: notification });
      } catch (cause) {
        /**
         * node:92658) UnsupportedWarning: The provided connection header is not valid, the value will be dropped from the header and will never be in use.
         * This is 'expected'
         * sse wants 0 headers lol (they are removed in Remix Express). Can't do that for Hono since reading response consume the ReadableStream :/
         */
        if (
          cause instanceof Error &&
          cause.message.match(/Controller is already closed/)
        ) {
          return;
        }

        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to send SSE notification",
            additionalData: { userId: authSession.userId },
            label: "Notification",
          })
        );
      }
    }
    emitter.on("notification", handle);

    return function clear() {
      emitter.off("notification", handle);
    };
  });
}
