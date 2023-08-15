import type { LoaderArgs } from "@remix-run/node";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { getUserTierLimit } from "~/modules/user";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

  /** Get the tier limit and check if they can export */
  const tierLimit = await getUserTierLimit(userId);
  if (!tierLimit?.canExportAssets) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const assets = await db.asset.findMany({
    where: {
      userId,
    },
  });

  const csvData = assets.map((asset) => Object.values(asset));

  if (!csvData) return null;
  csvData.unshift(Object.keys(assets[0])); // add header column
  const csvRows = csvData.map((row) => row.join(","));
  const csvString = csvRows.join("\n");

  return new Response(csvString, {
    status: 200,
    headers: {
      "content-type": "text/csv",
    },
  });
  return null;
};
