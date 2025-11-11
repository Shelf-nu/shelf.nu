import { data, type LoaderFunctionArgs } from "@remix-run/node";
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
      statuses: ["DRAFT"],
      takeAll: true,
      ...(isSelfServiceOrBase && { custodianUserId: userId }),
    });

    return payload({ bookings });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}
