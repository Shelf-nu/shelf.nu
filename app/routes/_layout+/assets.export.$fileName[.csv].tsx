import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertUserCanExportAssets } from "~/modules/tier";
import { exportAssetsToCsv } from "~/utils/csv.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  const { organizationId, organizations } = await requireOrganisationId(
    authSession,
    request
  );

  await assertUserCanExportAssets({ organizationId, organizations });

  /** Join the rows with a new line */
  const csvString = await exportAssetsToCsv({ organizationId });

  return new Response(csvString, {
    status: 200,
    headers: {
      "content-type": "text/csv",
    },
  });
};
