import { data, type LoaderFunctionArgs } from "@remix-run/node";
import { getBookings } from "~/modules/booking/service.server";
import { getDateTimeFormat } from "~/utils/client-hints";
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
    const bookingsData = await getBookings({
      organizationId,
      page,
      search,
      userId,
      statuses: ["DRAFT"],
      takeAll: true,
      ...(isSelfServiceOrBase && { custodianUserId: userId }),
    });

    // Format booking dates
    const bookings = bookingsData.bookings.map((b) => {
      if (b.from && b.to) {
        const from = new Date(b.from);
        const displayFrom = getDateTimeFormat(request, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(from);

        const to = new Date(b.to);
        const displayTo = getDateTimeFormat(request, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(to);

        return {
          ...b,
          displayFrom: displayFrom.split(","),
          displayTo: displayTo.split(","),
          metadata: {
            ...b,
            displayFrom: displayFrom.split(","),
            displayTo: displayTo.split(","),
          },
        };
      }
      return b;
    });

    return payload({ bookings });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}
