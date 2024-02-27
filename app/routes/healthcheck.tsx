// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { json } from "@remix-run/node";

import { db } from "~/database";

export async function loader() {
  try {
    // if we can connect to the database and make a simple query
    // and make a HEAD request to ourselves, then we're good.
    await db.user.findFirst();
    return json({ status: "OK" });
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.log("healthcheck ❌", { error });
    return json({ status: "ERROR" }, { status: 500 });
  }
}
