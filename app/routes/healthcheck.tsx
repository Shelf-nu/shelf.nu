// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { data } from "react-router";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";

export async function loader() {
  try {
    // if we can connect to the database and make a simple query
    // and make a HEAD request to ourselves, then we're good.
    await db.user.findFirst({
      select: { id: true },
    });
    return payload({ status: "OK" });
  } catch (cause) {
    return data(
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
