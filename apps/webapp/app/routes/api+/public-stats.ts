import { data } from "react-router";
import { db } from "~/database/db.server";
import { count } from "~/database/query-helpers.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";

export async function loader() {
  try {
    const [totalAssets, totalUsers, totalQrCodes] = await Promise.all([
      count(db, "asset", {}),
      count(db, "user", {}),
      count(db, "qr", {}),
    ]);

    return data(payload({ totalAssets, totalUsers, totalQrCodes }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
