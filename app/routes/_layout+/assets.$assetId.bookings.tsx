import { BookingStatus } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import { formatBookingsDates } from "~/modules/booking/utils.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
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

const BOOKING_STATUS_TO_SHOW = [
  BookingStatus.DRAFT,
  BookingStatus.COMPLETE,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
  BookingStatus.RESERVED,
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, canSeeAllBookings, canSeeAllCustody } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });

    const searchParams = getCurrentSearchParams(request);
    const { perPageParam } = getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const {
      page,
      search,
      status,
      teamMemberIds,
      orderBy,
      orderDirection,
      selfServiceData,
    } = await getBookingsFilterData({
      request,
      canSeeAllBookings,
      organizationId,
      userId,
    });

    const [{ bookings, bookingCount }, teamMembersData] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId: authSession?.userId,
        assetIds: [assetId],
        statuses: status ? [status] : BOOKING_STATUS_TO_SHOW,
        ...selfServiceData,
        orderBy,
        orderDirection,
        custodianTeamMemberIds: teamMemberIds,
      }),

      // team members/custodian
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        filterByUserId: !canSeeAllCustody, // If the user can see all custody, we don't filter by userId
        userId,
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
        ...teamMembersData,
      }),
      {
        headers: [
          setCookie(await userPrefs.serialize(cookie)),
          setCookie(await setSelectedOrganizationIdCookie(organizationId)),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "$assetId.bookings",
};

export default function AssetBookings() {
  return <BookingsIndexPage className="!mt-0" />;
}
