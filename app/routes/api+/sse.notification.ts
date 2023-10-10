import type { LoaderFunctionArgs } from "@remix-run/node";

import { eventStream } from "remix-utils/sse/server";
import { requireAuthSession } from "~/modules/auth";
import { emitter } from "~/utils/emitter/emitter.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);

  return eventStream(request.signal, function setup(send) {
    /** Notification is a strigified json object with the shape {@link Notification} */
    function handle(notification: string) {
      /** We only send the notification if the logged in userId is the same as the senderId.
       * We do this to prevent other users receiving notifications
       */
      if (authSession.userId !== JSON.parse(notification).senderId) return;
      send({ event: "new-notification", data: notification });
    }
    emitter.on("notification", handle);

    return function clear() {
      emitter.off("notification", handle);
    };
  });
}
