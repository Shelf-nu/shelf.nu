// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { json } from "@remix-run/node";

import { db } from "~/database";
import { data, error } from "~/utils";
import { ShelfError } from "~/utils/error";

export async function loader() {
  try {
    // if we can connect to the database and make a simple query
    // and make a HEAD request to ourselves, then we're good.
    await db.user.findFirst();
    return json(data({ status: "OK" }));
  } catch (cause) {
    return json(
      error(
        new ShelfError({
          cause,
          message: "Healthcheck failed",
          label: "Healthcheck",
        })
      )
    );
  }
}
