import { BookingStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { decorateBookingsForList } from "~/modules/booking/list-flags.server";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { TAG_WITH_COLOR_SELECT } from "~/modules/tag/constants";
import { getTagsForBookingTagsFilter } from "~/modules/tag/service.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { parseMarkdownToReact } from "~/utils/md";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import BookingsIndexPage, {
  bookingsSearchFieldTooltipText,
} from "./bookings._index";

const BOOKING_STATUS_TO_SHOW = [
  BookingStatus.DRAFT,
  BookingStatus.COMPLETE,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
  BookingStatus.RESERVED,
];

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
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
      tags: filterTags,
    } = await getBookingsFilterData({
      request,
      canSeeAllBookings,
      organizationId,
      userId,
    });

    const [{ bookings, bookingCount }, teamMembersData, tagsData] =
      await Promise.all([
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
          tags: filterTags,
          // PERF: the list renders booking-level fields plus an asset COUNT. The
          // per-booking `bookingAssets` payload existed only for the assets
          // drawer, which now fetches it from
          // `/api/bookings/:bookingId/assets-sidebar` when a row is expanded.
          includeAssets: false,
          extraInclude: {
            // Asset count for the row's drawer trigger, now that the pivot rows
            // themselves are no longer loaded.
            _count: { select: { bookingAssets: true } },
            tags: TAG_WITH_COLOR_SELECT,
            /**
             * Needed for the amber "N units unassigned" pill.
             *
             * `BookingsIndexPage` renders the same row component here as
             * `/bookings` does, and the pill reads `item.modelRequests`. Without
             * this include it is `undefined`, `countUnassignedModelUnits`
             * returns 0, and the pill silently disappears — so a booking with 4
             * unassigned units looked ready to go out on this tab while
             * `/bookings` flagged it. A signal that is only sometimes present is
             * worse than none, because its absence reads as "nothing to do".
             */
            modelRequests: {
              include: {
                assetModel: { select: { id: true, name: true } },
              },
            },
          },
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
        getTagsForBookingTagsFilter({
          organizationId,
        }),
      ]);

    const totalPages = Math.ceil(bookingCount / perPage);

    /**
     * Same amber "Stock conflict" pill as the main bookings index — this
     * route shares `ListBookingsContent` via `<BookingsIndexPage />` below,
     * so it needs the same per-booking flag wired in its own loader (see
     * `.claude/rules/quantity-semantics-per-surface.md` / the module doc in
     * `~/modules/booking/stock-conflicts.server`).
     */
    const decoratedBookings = await decorateBookingsForList({
      bookings,
      organizationId,
    });

    const header: HeaderData = {
      title: "Bookings",
    };
    const modelName = {
      singular: "booking",
      plural: "bookings",
    };

    return data(
      payload({
        header,
        items: decoratedBookings,
        search,
        page,
        totalItems: bookingCount,
        totalPages,
        perPage,
        modelName,
        ...teamMembersData,
        ...tagsData,
        searchFieldTooltip: {
          title: "Search your bookings",
          text: parseMarkdownToReact(bookingsSearchFieldTooltipText),
        },
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
    throw data(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "$assetId.bookings",
};

export default function AssetBookings() {
  return <BookingsIndexPage className="!mt-0" />;
}
