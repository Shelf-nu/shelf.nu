import type { LoaderArgs } from "@remix-run/node";

import { eventStream } from "remix-utils";
import { emitter } from "~/modules/emitter.server";

export async function loader({ request }: LoaderArgs) {
  return eventStream(request.signal, function setup(send) {
    function handle(notification: string) {
      send({ event: "new-notification", data: notification });
    }
    emitter.on("notification", handle);

    return function clear() {
      emitter.off("notification", handle);
    };
  });
}
