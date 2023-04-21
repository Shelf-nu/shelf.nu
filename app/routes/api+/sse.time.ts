import type { LoaderArgs } from "@remix-run/node";
import { eventStream } from "remix-utils";

export async function loader({ request }: LoaderArgs) {
  return eventStream(request.signal, function setup(send) {
    let counter = 0;
    let timer = setInterval(() => {
      send({ event: "time", data: (counter += 1).toString() });
    }, 1000);

    return function clear() {
      clearInterval(timer);
    };
  });
}
