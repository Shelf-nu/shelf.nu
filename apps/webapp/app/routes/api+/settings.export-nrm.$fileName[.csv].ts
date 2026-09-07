import { data, type LoaderFunctionArgs } from "react-router";
import { NRM_ID_PARAM } from "~/components/nrm/export-nrm-button";
import { csvResponse } from "~/utils/csv-utf8";
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
      // The export button forwards the index's current search params, so
      // "select all" exports exactly the filtered set the user can see.
      search: searchParams.get("s"),
    });

    return csvResponse(csvString);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
