import { json } from "@remix-run/node";
import { db } from "~/database";

export const loader = async () => {
  const [totalAssets, totalUsers, totalQrCodes] = await db.$transaction([
    db.asset.count(),
    db.user.count(),
    db.qr.count(),
  ]);

  return json(
    { totalAssets, totalUsers, totalQrCodes },
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=604800",
      },
    }
  );
};
