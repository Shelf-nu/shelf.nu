import { BookingStatus } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { getBookings } from "~/modules/booking/service.server";
import { getDateTimeFormat } from "~/utils/client-hints";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import BookingsIndexPage from "./bookings";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { userId: selectedUserId } = getParams(
    params,
    z.object({ userId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberProfile,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, status } =
      getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { bookings, bookingCount } = await getBookings({
      organizationId,
      page,
      perPage,
      search,
      userId: authSession?.userId,
      custodianUserId: selectedUserId,
      statuses: status ? [status] : Object.values(BookingStatus),
    });

    const totalPages = Math.ceil(bookingCount / perPage);

    const header: HeaderData = {
      title: "Bookings",
    };
    const modelName = {
      singular: "booking",
      plural: "bookings",
    };

    /** We format the dates on the server based on the users timezone and locale  */
    const items = bookings.map((b) => {
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
        };
      }
      return b;
    });

    return json(
      data({
        header,
        items,
        search,
        page,
        totalItems: bookingCount,
        totalPages,
        perPage,
        modelName,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "$userId.bookings",
};

export default function UserBookingsPage() {
  return <BookingsIndexPage className="!mt-0" disableBulkActions />;
}
