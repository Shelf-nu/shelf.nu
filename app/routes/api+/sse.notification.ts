import type { LoaderArgs } from "@remix-run/node";

import { eventStream } from "remix-utils";
import { requireAuthSession } from "~/modules/auth";
import emitter from "~/utils/emitter/emitter.server";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return eventStream(request.signal, function setup(send) {
    /** Notification is a strigified json object with the shape {@link Notification} */
    function handle(notification: string) {
      send({ event: "new-notification", data: notification });
    }
    emitter.on("notification", handle);

    return function clear() {
      emitter.off("notification", handle);
    };
  });
}
