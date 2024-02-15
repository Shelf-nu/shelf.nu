import type { LoaderFunctionArgs } from "@remix-run/node";
import { eventStream } from "remix-utils/sse/server";
import { emitter } from "~/utils/emitter/emitter.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();

  return eventStream(request.signal, function setup(send) {
    /** Notification is a strigified json object with the shape {@link Notification} */
    function handle(notification: string) {
      /** We only send the notification if the logged in userId is the same as the senderId.
       * We do this to prevent other users receiving notifications
       */
      if (authSession.userId !== JSON.parse(notification).senderId) return;

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
          // eslint-disable-next-line no-console
          console.error("ERROR: Failed to send SSE notification");
        }
      }
    }
    emitter.on("notification", handle);

    return function clear() {
      emitter.off("notification", handle);
    };
  });
}
