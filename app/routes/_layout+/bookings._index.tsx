import type { Prisma } from "@prisma/client";
import { TagUseFor } from "@prisma/client";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Link, Outlet, useMatches } from "@remix-run/react";
import { AvailabilityBadge } from "~/components/booking/availability-label";
import { BookingAssetsSidebar } from "~/components/booking/booking-assets-sidebar";
import BookingFilters from "~/components/booking/booking-filters";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import BulkActionsDropdown from "~/components/booking/bulk-actions-dropdown";
import CreateBookingDialog from "~/components/booking/create-booking-dialog";
import { ExportBookingsButton } from "~/components/booking/export-bookings-button";
import { ErrorContent } from "~/components/errors";

import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import ItemsWithViewMore from "~/components/list/items-with-view-more";
import { Button } from "~/components/shared/button";
import { UserBadge } from "~/components/shared/user-badge";
import { Td, Th } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import { formatBookingsDates } from "~/modules/booking/utils.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
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

    /** We only do that when we are on the index page */
    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/bookings?${cookieParams.toString()}`);
    }

    const [{ bookings, bookingCount }, teamMembersData, tags] =
      await Promise.all([
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
          extraInclude: {
            tags: { select: { id: true, name: true } },
          },
        }),

        // team members/custodian
        getTeamMemberForCustodianFilter({
          organizationId,
          selectedTeamMembers: teamMemberIds,
          getAll:
            searchParams.has("getAll") &&
            hasGetAllValue(searchParams, "teamMember"),
          filterByUserId: !canSeeAllCustody, // If they cant see custody, we dont render the filters anyways, however we still add this for performance reasons so we dont load all team members. This way we only load the current user's team member as that is the only one they can see
          userId,
        }),

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
        currentOrganization,
        items,
        search,
        page,
        totalItems: bookingCount,
        totalPages,
        perPage,
        modelName,
        ...teamMembersData,
        isSelfServiceOrBase,
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
    throw json(error(reason), { status: reason.status });
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

const ListBookingsContent = ({
  item,
}: {
  item: Prisma.BookingGetPayload<{
    include: {
      assets: {
        select: {
          id: true;
          title: true;
          availableToBook: true;
          custody: true;
          kitId: true;
          status: true;
          mainImage: true;
          thumbnailImage: true;
          mainImageExpiration: true;
          category: {
            select: {
              id: true;
              name: true;
              color: true;
            };
          };
          kit: {
            select: {
              id: true;
              name: true;
            };
          };
        };
      };
      creator: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          profilePicture: true;
        };
      };
      from: true;
      to: true;
      custodianUser: true;
      custodianTeamMember: true;
      tags: { select: { id: true; name: true } };
    };
  }> & {
    displayFrom?: string[];
    displayTo?: string[];
  };
}) => {
  const hasUnavaiableAssets =
    item.assets.some(
      (asset) => !asset.availableToBook || asset.custody !== null
    ) && !["COMPLETE", "CANCELLED", "ARCHIVED"].includes(item.status);

  return (
    <>
      {/* Item */}
      <Td className="w-full min-w-52 whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/bookings/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                >
                  {item.name}
                </Button>
              </span>
              <div className="">
                <BookingStatusBadge
                  status={item.status}
                  custodianUserId={item.custodianUserId || undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/**
       * Optional label when the booking includes assets that are either:
       * 1. Marked as not available for boooking
       * 2. Have custody
       * 3. Have other bookings with the same period - this I am not sure how to handle yet
       * */}
      <Td>
        {hasUnavaiableAssets ? (
          <AvailabilityBadge
            badgeText={"Includes unavailable assets"}
            tooltipTitle={"Booking includes unavailable assets"}
            tooltipContent={
              "There are some assets within this booking that are unavailable for reservation because they are checked-out, have custody assigned or are marked as not allowed to book"
            }
          />
        ) : null}
      </Td>

      {/* Assets count */}
      <Td>
        <BookingAssetsSidebar booking={item} />
      </Td>

      <Td className="max-w-62">
        {item.description ? <LineBreakText text={item.description} /> : null}
      </Td>

      {/* From */}
      <Td>
        {item.displayFrom ? (
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.displayFrom[0]}
            </span>
            <span className="block text-gray-600">{item.displayFrom[1]}</span>
          </div>
        ) : null}
      </Td>

      {/* To */}
      <Td>
        {item.displayTo ? (
          <div className="min-w-[130px]">
            <span className="word-break mb-1 block font-medium">
              {item.displayTo[0]}
            </span>
            <span className="block text-gray-600">{item.displayTo[1]}</span>
          </div>
        ) : null}
      </Td>

      <Td className="max-w-[auto]">
        <ItemsWithViewMore
          items={item.tags}
          idKey="id"
          labelKey="name"
          emptyMessage={<div className="text-sm text-gray-500">No tags</div>}
        />
      </Td>

      {/* Custodian */}

      <Td>
        <TeamMemberBadge
          teamMember={{
            name: item.custodianTeamMember
              ? item.custodianTeamMember.name
              : `${item.custodianUser?.firstName} ${item.custodianUser?.lastName}`,
            user: item?.custodianUser
              ? {
                  id: item?.custodianUser?.id,
                  firstName: item?.custodianUser?.firstName,
                  lastName: item?.custodianUser?.lastName,
                  email: item?.custodianUser?.email,
                  profilePicture: item?.custodianUser?.profilePicture,
                }
              : null,
          }}
        />
      </Td>

      {/* Created by */}
      <Td>
        <UserBadge
          img={
            item?.creator?.profilePicture || "/static/images/default_pfp.jpg"
          }
          name={`${item?.creator?.firstName || ""} ${
            item?.creator?.lastName || ""
          }`}
        />
      </Td>
    </>
  );
};

export const ErrorBoundary = () => <ErrorContent />;
