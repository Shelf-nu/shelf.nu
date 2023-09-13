import type { LoaderArgs } from "@remix-run/node";
import { fetchAssetsForExport } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { assertUserCanExportAssets } from "~/modules/tier";
import { buildCsvDataFromAssets } from "~/utils";

/* There are some keys that need to be skipped and require special handling */
const keysToSkip = [
  "userId",
  "organizationId",
  "categoryId",
  "locationId",
  "customFieldId",
];

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);

  await assertUserCanExportAssets({ userId });

  const assets = await fetchAssetsForExport({ userId });

  const csvData = buildCsvDataFromAssets({
    assets,
    keysToSkip,
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
