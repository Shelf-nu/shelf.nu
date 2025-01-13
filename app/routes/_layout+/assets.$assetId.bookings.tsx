import { BookingStatus } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { getBookings } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
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
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, status, teamMemberIds } =
      getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const [{ bookings, bookingCount }, teamMembersData] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId: authSession?.userId,
        assetIds: [assetId],
        statuses: status ? [status] : BOOKING_STATUS_TO_SHOW,
        ...(isSelfServiceOrBase && {
          // If the user is self service, we only show bookings that belong to that user)
          custodianUserId: authSession?.userId,
        }),
        custodianTeamMemberIds: teamMemberIds,
      }),

      // team members/custodian
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        isSelfService: isSelfServiceOrBase, // we can assume this is false because this view is not allowed for
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
