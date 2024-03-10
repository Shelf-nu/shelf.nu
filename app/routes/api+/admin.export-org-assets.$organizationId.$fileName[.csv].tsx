import type { LoaderFunctionArgs } from "@remix-run/node";
import { getRequiredParam } from "~/utils";
import { exportAssetsToCsv } from "~/utils/csv.server";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  await requireAdmin(authSession.userId);
  const organizationId = getRequiredParam(params, "organizationId");

  /** Join the rows with a new line */
  const csvString = await exportAssetsToCsv({ organizationId });

  return new Response(csvString, {
    status: 200,
    headers: {
      "content-type": "text/csv",
    },
  });
};
