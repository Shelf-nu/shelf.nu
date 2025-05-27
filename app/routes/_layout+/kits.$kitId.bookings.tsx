import { BookingStatus } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { getBookings } from "~/modules/booking/service.server";
import { formatBookingsDates } from "~/modules/booking/utils.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
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

const BOOKING_STATUS_TO_SHOW = [
  BookingStatus.DRAFT,
  BookingStatus.COMPLETE,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
  BookingStatus.RESERVED,
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId, canSeeAllBookings } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, status, teamMemberIds } =
      getParamsValues(searchParams);

    const { perPage } = await updateCookieWithPerPage(request, perPageParam);

    const [{ bookings, bookingCount }, teamMembersData] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId,
        statuses: status ? [status] : BOOKING_STATUS_TO_SHOW,
        ...(!canSeeAllBookings && {
          // If the user is self service, we only show bookings that belong to that user)
          custodianUserId: userId,
        }),
        custodianTeamMemberIds: teamMemberIds,
      }),

      // TeamMember data for custodian
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        userId,
      }),
    ]);

    const totalPages = Math.ceil(bookingCount / perPage);

    const header: HeaderData = {
      title: "Kit Bookings",
    };

    const modelName = {
      singular: "booking",
      plural: "bookings",
    };

    const items = formatBookingsDates(bookings, request);

    return json(
      data({
        header,
        items,
        search,
        page,
        perPage,
        totalItems: bookingCount,
        totalPages,
        modelName,
        ...teamMembersData,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "$kitId.bookings",
};

export default function KitBookings() {
  return <BookingsIndexPage className="!mt-0" />;
}
