import { TagUseFor } from "@prisma/client";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunction,
} from "react-router";
import { data, redirect, Link, Outlet, useMatches } from "react-router";
import BookingFilters from "~/components/booking/booking-filters";
import BulkActionsDropdown from "~/components/booking/bulk-actions-dropdown";
import CreateBookingDialog from "~/components/booking/create-booking-dialog";
import { ExportBookingsButton } from "~/components/booking/export-bookings-button";
import ListBookingsContent from "~/components/booking/list-bookings-content";
import { ErrorContent } from "~/components/errors";

import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Button } from "~/components/shared/button";
import { Th } from "~/components/table";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { decorateBookingsForList } from "~/modules/booking/list-flags.server";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { TAG_WITH_COLOR_SELECT } from "~/modules/tag/constants";
import {
  getTeamMemberForCustodianFilter,
  getTeamMemberForForm,
  getTeamMembersForNotify,
} from "~/modules/team-member/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { computeHasActiveFilters } from "~/utils/filter-params";
import { payload, error } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const bookingsSearchFieldTooltipText = `
Search bookings based on different fields. Separate your keywords by a comma(,) to search with OR condition. Supported fields are: 
- Name
- Description
- Tags
- Custodian names (first or last name)
- Asset names
- Asset barcodes or qr code
`;

export type BookingsIndexLoaderData = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const {
      organizationId,
      currentOrganization,
      isSelfServiceOrBase,
      canSeeAllBookings,
      canSeeAllCustody,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    if (isPersonalOrg(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You cannot use bookings in a personal workspaces. Please create a Team workspace to create bookings.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }
    const {
      page,
      perPage,
      search,
      status,
      teamMemberIds,
      orderBy,
      orderDirection,
      selfServiceData,
      searchParams,
      cookie,
      filtersCookie,
      filters,
      redirectNeeded,
      tags: filterTags,
    } = await getBookingsFilterData({
      request,
      canSeeAllBookings,
      organizationId,
      userId,
    });

    const hasActiveFilters = computeHasActiveFilters(searchParams);

    /** We only do that when we are on the index page */
    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/bookings?${cookieParams.toString()}`);
    }

    const [
      { bookings, bookingCount },
      teamMembersData,
      teamMembersForFormData,
      tags,
      notifyData,
    ] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId: userId,
        ...(status && {
          // If status is in the params, we filter based on it
          statuses: [status],
        }),
        custodianTeamMemberIds: teamMemberIds,
        ...selfServiceData,
        orderBy,
        orderDirection,
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
          // Include outstanding model-level reservations so the
          // assets-sidebar drawer can render the "Unassigned model
          // reservations (N)" section — and so the drawer trigger opens
          // for pure book-by-model bookings (0 concrete assets, N
          // reserved models).
          modelRequests: {
            include: {
              assetModel: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),

      // team members for filter dropdown
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        filterByUserId: !canSeeAllCustody, // If they cant see custody, we dont render the filters anyways, however we still add this for performance reasons so we dont load all team members. This way we only load the current user's team member as that is the only one they can see
        userId,
      }),

      // team members for booking form - BASE/SELF_SERVICE users need their team member guaranteed
      isSelfServiceOrBase
        ? getTeamMemberForForm({
            organizationId,
            userId,
            isSelfServiceOrBase,
            getAll:
              searchParams.has("getAll") &&
              hasGetAllValue(searchParams, "teamMember"),
          })
        : Promise.resolve(null), // ADMIN users reuse teamMembersData

      db.tag.findMany({
        where: {
          organizationId,
          OR: [
            { useFor: { isEmpty: true } },
            { useFor: { has: TagUseFor.BOOKING } },
          ],
        },
        orderBy: { name: "asc" },
      }),
      getTeamMembersForNotify({ organizationId }),
    ]);

    const totalPages = Math.ceil(bookingCount / perPage);

    /**
     * The two row pills — amber "Stock conflict" (≥1 over-committed
     * QUANTITY_TRACKED asset in this booking's window) and "Includes
     * unavailable assets" — both need a query the booking row cannot answer.
     * `decorateBookingsForList` runs them concurrently, bounded to the current
     * page's bookings. See `~/modules/booking/list-flags.server`.
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
        currentOrganization,
        items: decoratedBookings,
        search,
        page,
        totalItems: bookingCount,
        totalPages,
        perPage,
        modelName,
        hasActiveFilters,
        ...teamMembersData,
        // For BASE/SELF_SERVICE users, provide dedicated form team members
        // For ADMIN users, reuse the filter team members
        teamMembersForForm:
          teamMembersForFormData?.teamMembers ?? teamMembersData.teamMembers,
        isSelfServiceOrBase,
        ...notifyData,
        tags,
        totalTags: tags.length,
        searchFieldTooltip: {
          title: "Search your bookings",
          text: parseMarkdownToReact(bookingsSearchFieldTooltipText),
        },
      }),
      {
        headers: [
          setCookie(await userPrefs.serialize(cookie)),
          setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ...(filtersCookie ? [setCookie(filtersCookie)] : []),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  name: "bookings.index",
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  actionResult,
  nextUrl,
  defaultShouldRevalidate,
}) => {
  /** Don't revalidate on manage-assets route */
  const isManageAssetsRoute = nextUrl.pathname.includes("manage-assets");

  if (isManageAssetsRoute || actionResult?.isTogglingSidebar) {
    return false;
  }
  return defaultShouldRevalidate;
};

export default function BookingsIndexPage({
  className,
  disableBulkActions = false,
}: {
  className?: string;
  disableBulkActions?: boolean;
}) {
  const matches = useMatches();
  const { isBaseOrSelfService } = useUserRoleHelper();

  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  /**
   * We have 4 cases when we should render index:
   * 1. When we are on the index route
   * 2. When we are on the .new route - the reason we do this is because we want to have the .new modal overlaying the index.
   * 3. When we are on the assets.$assetId.bookings page
   * 4. When we are on the settings.team.users.$userId.bookings
   */

  const allowedRoutes = [
    "bookings.index",
    "bookings.new",
    "$assetId.bookings",
    "$userId.bookings",
    "bookings.update-existing",
    "me.bookings",
    "$kitId.bookings",
  ];

  const shouldRenderIndex = allowedRoutes.includes(currentRoute?.handle?.name);

  /** A bookings page that is a child of another nested layout */
  const isChildBookingsPage = [
    "$assetId.bookings",
    "$userId.bookings",
    "me.bookings",
    "$kitId.bookings",
  ].includes(currentRoute?.handle?.name);

  const isBookingUpdateExisting =
    currentRoute?.handle?.name === "bookings.update-existing";

  return shouldRenderIndex ? (
    //when we are clicking on book actions dropdown. it is picking styles from global scope. to bypass that adding this wrapper.(dailog styles)
    <div
      className={`${
        isBookingUpdateExisting ? "booking-update-existing-wrapper" : ""
      }`}
    >
      {!isChildBookingsPage ? (
        <Header>
          <CreateBookingDialog
            trigger={
              <Button
                type="button"
                aria-label="new booking"
                data-test-id="createNewBooking"
                prefetch="none"
              >
                New booking
              </Button>
            }
          />
        </Header>
      ) : null}
      <ListContentWrapper className={className}>
        <BookingFilters />

        <List
          bulkActions={
            disableBulkActions || isBaseOrSelfService ? undefined : (
              <BulkActionsDropdown />
            )
          }
          customEmptyStateContent={{
            title: "No bookings yet",
            text: "Bookings let your team reserve assets for specific dates. Create a booking to schedule equipment checkouts and returns.",
            newButtonRoute: "/bookings/new",
            newButtonContent: "Create your first booking",
          }}
          ItemComponent={ListBookingsContent}
          headerChildren={
            <>
              <Th />
              <Th>Assets</Th>
              <Th>Description</Th>

              <Th>From</Th>
              <Th>To</Th>
              <Th>Tags</Th>
              <Th>Custodian</Th>
              <Th>Created by</Th>
            </>
          }
          headerExtraContent={
            <>
              <ExportBookingsButton />
            </>
          }
        />
      </ListContentWrapper>
      <ContextualModal />
    </div>
  ) : (
    <Outlet />
  );
}

export const ErrorBoundary = () => <ErrorContent />;
