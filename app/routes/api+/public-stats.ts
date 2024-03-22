import { json } from "@remix-run/node";
import { db } from "~/database/db.server";
import { data, error, makeShelfError } from "~/utils";

export async function loader() {
  try {
    const [totalAssets, totalUsers, totalQrCodes] = await Promise.all([
      db.asset.count(),
      db.user.count(),
      db.qr.count(),
    ]);

    return json(data({ totalAssets, totalUsers, totalQrCodes }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}
