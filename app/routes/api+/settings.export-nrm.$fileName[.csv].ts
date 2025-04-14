import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { NRM_ID_PARAM } from "~/components/nrm/export-nrm-button";
import { exportNRMsToCsv } from "~/utils/csv.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.export,
    });

    const searchParams = getCurrentSearchParams(request);
    const nrmIds = searchParams.get(NRM_ID_PARAM);

    if (!nrmIds) {
      throw new ShelfError({
        cause: null,
        label: "Team Member",
        message: "No NRMs selected",
      });
    }

    const csvString = await exportNRMsToCsv({
      organizationId,
      nrmIds: nrmIds.split(","),
    });

    return new Response(csvString, {
      status: 200,
      headers: { "Content-Type": "text/csv" },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
