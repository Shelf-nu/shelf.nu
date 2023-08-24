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
      /** Skip keys that are not needed. These are foreign keys for the related entries */
      if (keysToSkip.includes(key)) return;

      /** If the value is null, push an empty string
       * We have a bit of a special case, for the relations that are objects, we need to push an empty object instead of an empty string.
       * This way we prevent the import from failing when importing the file again due to "Invalid JSON"
       * This needs to be done for all one-to-one relations
       */
      if (value === null) {
        if (["custody", "location", "category"].includes(key)) {
          return toExport.push("{}");
        }
        return toExport.push("");
      }

      /** Special handling for category and location */
      switch (key) {
        case "location":
        case "category":
        case "notes":
        case "tags":
        case "qrCodes":
        case "custody":
        case "organization":
        case "reports":
          toExport.push(
            JSON.stringify(value, (_key, value) => {
              /** Custom replacer function.
               * We do this to ensure that in the result we have emtpy strings instead of null values
               */
              if (value === null) {
                return "";
              }
              return value;
            })
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
