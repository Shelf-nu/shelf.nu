import { data, type LoaderFunctionArgs } from "react-router";
import { getBookings } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
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

    const { page, search } = getParamsValues(getCurrentSearchParams(request));
    const { bookings } = await getBookings({
      organizationId,
      page,
      search,
      userId,
      // Include active bookings so the bulk "add to existing booking" dialog can
      // target ONGOING/OVERDUE bookings too (added assets stay AVAILABLE —
      // progressive checkout), not just DRAFT/RESERVED ones.
      statuses: ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"],
      takeAll: true,
      ...(isSelfServiceOrBase && { custodianUserId: userId }),
    });

    return data(payload({ bookings }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}
