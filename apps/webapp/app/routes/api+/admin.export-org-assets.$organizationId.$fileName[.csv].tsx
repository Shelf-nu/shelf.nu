/** Admin CSV export route for an organization's asset backup. */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { csvResponse } from "~/utils/csv-utf8";
import { exportAssetsBackupToCsv } from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { buildContentDisposition, error, getParams } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

/** Exports an organization's asset backup as a CSV download for administrators. */
export async function loader({ context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId, fileName } = getParams(
    params,
    z.object({ organizationId: z.string(), fileName: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    await requireAdmin(authSession.userId);

    /** Join the rows with a new line */
    const csvString = await exportAssetsBackupToCsv({ organizationId });

    return csvResponse(csvString, {
      headers: {
        "content-disposition": buildContentDisposition(null, {
          fallback: "assets",
          filename: `${fileName}.csv`,
        }),
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
