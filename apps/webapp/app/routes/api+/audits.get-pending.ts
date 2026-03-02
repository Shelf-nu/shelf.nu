import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

import { getPendingAuditsForOrganization } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import { error, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const audits = await getPendingAuditsForOrganization({ organizationId });

    return data(payload({ audits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
