// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { json, type LoaderFunctionArgs } from "@remix-run/node";

import { db } from "~/database";

export async function loader({ request }: LoaderFunctionArgs) {
  const host =
    request.headers.get("X-Forwarded-Host") ?? request.headers.get("host");

  try {
    const url = new URL("/", `http://${host}`);
    // if we can connect to the database and make a simple query
    // and make a HEAD request to ourselves, then we're good.
    await Promise.all([
      db.user.findFirst(),
      fetch(url.toString(), { method: "HEAD" }).then((r) => {
        if (!r.ok) return Promise.reject(r);
      }),
    ]);
    return json({ status: "OK" });
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.log("healthcheck ❌", { error });
    return json({ status: "ERROR" }, { status: 500 });
  }
}
