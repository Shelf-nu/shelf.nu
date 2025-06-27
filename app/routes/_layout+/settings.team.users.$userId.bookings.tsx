import { TagUseFor } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { db } from "~/database/db.server";
import { getBookings } from "~/modules/booking/service.server";
import { formatBookingsDates } from "~/modules/booking/utils.server";
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
import BookingsIndexPage from "./bookings._index";

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
    const {
      page,
      perPageParam,
      search,
      status,
      tags: filterTags,
    } = getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const [{ bookings, bookingCount }, tags] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId: authSession?.userId,
        custodianUserId: selectedUserId, // Here we just hardcode the userId because user profiles cannot be seen by other selfService or Base users
        ...(status && {
          // If status is in the params, we filter based on it
          statuses: [status],
        }),
        tags: filterTags,
        extraInclude: {
          tags: { select: { id: true, name: true } },
        },
      }),
      db.tag.findMany({
        where: {
          organizationId,
          OR: [
            { useFor: { isEmpty: true } },
            { useFor: { has: TagUseFor.BOOKING } },
          ],
        },
      }),
    ]);
    const totalPages = Math.ceil(bookingCount / perPage);

    const header: HeaderData = {
      title: "Bookings",
    };
    const modelName = {
      singular: "booking",
      plural: "bookings",
    };

    /** We format the dates on the server based on the users timezone and locale  */
    const items = formatBookingsDates(bookings, request);

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
        tags,
        totalTags: tags.length,
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
  return <BookingsIndexPage disableBulkActions />;
}
