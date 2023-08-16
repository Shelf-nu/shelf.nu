import type { Category, Location } from "@prisma/client";
import type { LoaderArgs } from "@remix-run/node";
import { fetchAssetsForExport } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { getUserTierLimit } from "~/modules/user";

/* There are some keys that need to be skipped and require special handling */
const keysToSkip = ["userId", "organizationId", "categoryId", "locationId"];

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

  /** Get the tier limit and check if they can export */
  const tierLimit = await getUserTierLimit(userId);
  if (!tierLimit?.canExportAssets) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const assets = await fetchAssetsForExport({ userId });

  const csvData = assets.map((asset) => {
    const toExport: string[] = [];

    /** Itterate over the values to create teh export object */
    Object.entries(asset).forEach(([key, value]) => {
      /** Skip keys that are not needed */
      if (keysToSkip.includes(key)) return;

      /** If the value is null, push an empty string */
      if (value === null) return toExport.push("");

      /** Special handling for category and location */
      switch (key) {
        case "location":
        case "category":
        case "notes":
          toExport.push(JSON.stringify(value));
          break;
        case "custody":
          toExport.push(
            (value as { custodian: { name: string } }).custodian.name
          );
          break;
        default:
          toExport.push(String(value));
      }
    });

    return toExport;
  });

  if (!csvData) return null;
  /** Get the headers from the first row and filter out the keys to skip */
  const headers = Object.keys(assets[0]).filter(
    (header) => !keysToSkip.includes(header)
  );

  /** Add the header column */
  csvData.unshift(headers);

  /** Convert the data to a string */
  const csvRows = csvData.map((row) => row.join(";"));

  /** Join the rows with a new line */
  const csvString = csvRows.join("\n");

  return new Response(csvString, {
    status: 200,
    headers: {
      "content-type": "text/csv",
    },
  });
};
