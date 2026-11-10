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

/**
 * Lists the pending audits the caller can add assets to, for the bulk
 * "Add to existing audit" picker.
 *
 * @returns `{ audits }`, or an error payload with the failure's status
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    // `audit: update` authorizes updating audits in general, not every audit:
    // a member limited to assigned audits only sees the ones assigned to them.
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const audits = await getPendingAuditsForOrganization({
      organizationId,
      userId,
      assignedOnly: !access.audits.seeAll,
    });

    return data(payload({ audits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
