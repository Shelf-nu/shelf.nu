import { data, type LoaderFunctionArgs } from "react-router";
import { getMinimalBookings } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    // The "add to existing booking" dialog renders only a name + date range and
    // filters client-side, so fetch the slim projection (no per-booking asset /
    // kit / custodian tree, no count query) instead of the full index shape.
    const { bookings } = await getMinimalBookings({
      organizationId,
      userId,
      // Include active bookings so the dialog can target ONGOING/OVERDUE
      // bookings too (added assets stay AVAILABLE — progressive checkout), not
      // just DRAFT/RESERVED ones.
      statuses: ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"],
      ...(isSelfServiceOrBase && { custodianUserId: userId }),
    });

    return data(payload({ bookings }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}
