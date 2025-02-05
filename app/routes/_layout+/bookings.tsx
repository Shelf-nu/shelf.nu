import type { Prisma } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Link, Outlet, useMatches, useNavigate } from "@remix-run/react";
import { ChevronRight } from "lucide-react";
import { AvailabilityBadge } from "~/components/booking/availability-label";
import BulkActionsDropdown from "~/components/booking/bulk-actions-dropdown";
import CreateBookingDialog from "~/components/booking/create-booking-dialog";
import { StatusFilter } from "~/components/booking/status-filter";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ErrorContent } from "~/components/errors";

import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBookings } from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { bookingStatusColorMap } from "~/utils/bookings";
import { getDateTimeFormat } from "~/utils/client-hints";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, isSelfServiceOrBase, currentOrganization } =
      await requirePermission({
        userId: authSession?.userId,
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

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, status, teamMemberIds } =
      getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    /**
     * For self service and base users, we need to get the teamMember to be able to filter by it as well.
     * This is to handle a case when a booking was assigned when there wasn't a user attached to a team member but they were later on linked.
     * This is to ensure that the booking is still visible to the user that was assigned to it.
     * Also this shouldn't really happen as we now have a fix implemented when accepting invites,
     * to make sure it doesnt happen, hwoever its good to keep this as an extra safety thing.
     * Ideally in the future we should remove this as it adds another query to the db
     * @TODO this can safely be remove 3-6 months after this commit
     */
    let selfServiceData = null;
    if (isSelfServiceOrBase) {
      const teamMember = await db.teamMember.findFirst({
        where: {
          userId,
          organizationId,
        },
      });
      if (!teamMember) {
        throw new ShelfError({
          cause: null,
          title: "Team member not found",
          message:
            "You are not part of a team in this organization. Please contact your organization admin to resolve this",
          label: "Booking",
          shouldBeCaptured: false,
        });
      }
      selfServiceData = {
        // If the user is self service, we only show bookings that belong to that user)
        custodianUserId: authSession?.userId,
        custodianTeamMemberId: teamMember.id,
      };
    }

    const [{ bookings, bookingCount }, teamMembersData] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId: authSession?.userId,
        ...(status && {
          // If status is in the params, we filter based on it
          statuses: [status],
        }),
        custodianTeamMemberIds: teamMemberIds,
        ...selfServiceData,
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
        isSelfServiceOrBase,
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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  name: "bookings.index",
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  nextUrl,
  defaultShouldRevalidate,
}) => {
  /** Dont revalidate on add-assets route */
  const isAddAssetsRoute = nextUrl.pathname.includes("add-assets");
  if (isAddAssetsRoute) {
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
  const navigate = useNavigate();
  const matches = useMatches();

  const { isBaseOrSelfService, roles } = useUserRoleHelper();

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
  ];

  const shouldRenderIndex = allowedRoutes.includes(currentRoute?.handle?.name);

  /** A bookings page that is a child of another nested layout */
  const isChildBookingsPage = [
    "$assetId.bookings",
    "$userId.bookings",
    "me.bookings",
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
        <Filters
          slots={{
            "left-of-search": <StatusFilter statusItems={BookingStatus} />,
          }}
        >
          <When
            truthy={
              userHasPermission({
                roles,
                entity: PermissionEntity.custody,
                action: PermissionAction.read,
              }) &&
              !isBaseOrSelfService &&
              !["$userId.bookings", "me.bookings"].includes(
                // on the user bookings page we dont want to show the custodian filter becuase they are alreayd filtered for that user
                currentRoute?.handle?.name
              )
            }
          >
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Custodian{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{
                name: "teamMember",
                queryKey: "name",
                deletedAt: null,
              }}
              renderItem={(item) => resolveTeamMemberName(item, true)}
              label="Filter by custodian"
              placeholder="Search team members"
              initialDataKey="teamMembers"
              countKey="totalTeamMembers"
            />
          </When>
        </Filters>
        <List
          bulkActions={
            disableBulkActions || isBaseOrSelfService ? undefined : (
              <BulkActionsDropdown />
            )
          }
          ItemComponent={ListAssetContent}
          navigate={(id) => navigate(`/bookings/${id}`)}
          headerChildren={
            <>
              <Th />
              <Th>Description</Th>

              <Th>From</Th>
              <Th>To</Th>
              <Th>Custodian</Th>
              <Th>Created by</Th>
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

const ListAssetContent = ({
  item,
}: {
  item: Prisma.BookingGetPayload<{
    include: {
      assets: {
        select: {
          id: true;
          availableToBook: true;
          custody: true;
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
                {item.name}
              </span>
              <div className="">
                <Badge color={bookingStatusColorMap[item.status]}>
                  <span className="block lowercase first-letter:uppercase">
                    {item.status}
                  </span>
                </Badge>
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

      {/* Custodian */}
      <Td>
        {item?.custodianUser ? (
          <UserBadge
            img={
              item?.custodianUser?.profilePicture ||
              "/static/images/default_pfp.jpg"
            }
            name={`${item?.custodianUser?.firstName || ""} ${
              item?.custodianUser?.lastName || ""
            }`}
          />
        ) : item?.custodianTeamMember ? (
          <UserBadge name={item.custodianTeamMember.name} />
        ) : null}
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

function UserBadge({ img, name }: { img?: string; name: string }) {
  return (
    <span className="inline-flex w-max items-center justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700">
      <img
        src={img || "/static/images/default_pfp.jpg"}
        className="mr-1 size-4 rounded-full"
        alt=""
      />
      <span className="mt-px">{name}</span>
    </span>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
