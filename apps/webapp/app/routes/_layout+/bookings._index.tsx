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
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import { decorateBookingsWithStockConflicts } from "~/modules/booking/stock-conflicts.server";
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
        extraInclude: {
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
     * One amber "Stock conflict" pill per booking that has ≥1 over-committed
     * QUANTITY_TRACKED asset in its window (see
     * `~/modules/booking/stock-conflicts.server`). Bounded to the current
     * page's bookings — same batching contract as the disposition/checkout
     * maps below, just one more fixed-cost query group.
     */
    const decoratedBookings = await decorateBookingsWithStockConflicts({
      bookings,
      organizationId,
    });

    /**
     * Compute a per-booking map of `assetId → dispositionedQty` (sum
     * of RETURN + CONSUME + LOSS + DAMAGE ConsumptionLog rows) for
     * every qty-tracked asset currently visible on this page. Feeds
     * the `BookingAssetsSidebar` so it can render the same qty
     * progress indicator and "Partially checked in" badge the
     * overview page uses.
     *
     * Strategy: one aggregate query scoped to the bookingIds on this
     * page (at most `perPage` bookings, so bounded). Then we bucket the
     * rows by bookingId and store a Map<string, Record<string, number>>
     * keyed by bookingId. Empty record for bookings with no activity.
     */
    const bookingIdsOnPage = bookings.map((b) => b.id);
    const dispositionRows =
      bookingIdsOnPage.length > 0
        ? await db.consumptionLog.groupBy({
            by: ["bookingId", "assetId", "category"],
            where: {
              bookingId: { in: bookingIdsOnPage },
              category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
            },
            _sum: { quantity: true },
          })
        : [];
    /**
     * Per-booking → per-asset disposition totals AND a per-category
     * breakdown. The sidebar tooltip uses the breakdown to show
     * Returned / Consumed / Lost / Damaged separately (lost and
     * damaged units are conceptually different from returned ones).
     * Both derivations come from the same single groupBy — no extra
     * DB round-trip.
     */
    const dispositionedByBooking: Record<string, Record<string, number>> = {};
    const dispositionBreakdownByBooking: Record<
      string,
      Record<
        string,
        { returned: number; consumed: number; lost: number; damaged: number }
      >
    > = {};
    for (const row of dispositionRows) {
      if (!row.bookingId) continue;
      const qty = row._sum.quantity ?? 0;

      if (!dispositionedByBooking[row.bookingId]) {
        dispositionedByBooking[row.bookingId] = {};
      }
      dispositionedByBooking[row.bookingId][row.assetId] =
        (dispositionedByBooking[row.bookingId][row.assetId] ?? 0) + qty;

      if (!dispositionBreakdownByBooking[row.bookingId]) {
        dispositionBreakdownByBooking[row.bookingId] = {};
      }
      const bucket =
        dispositionBreakdownByBooking[row.bookingId][row.assetId] ??
        ({
          returned: 0,
          consumed: 0,
          lost: 0,
          damaged: 0,
        } as const);
      const next = { ...bucket };
      if (row.category === "RETURN") next.returned += qty;
      else if (row.category === "CONSUME") next.consumed += qty;
      else if (row.category === "LOSS") next.lost += qty;
      else if (row.category === "DAMAGE") next.damaged += qty;
      dispositionBreakdownByBooking[row.bookingId][row.assetId] = next;
    }

    /**
     * Per-booking → per-asset progressively-checked-out total. Sums
     * `PartialBookingCheckout.quantities[i]` across every checkout
     * session for the bookings on this page, bucketed by
     * `(bookingId, assetIds[i])`. Feeds the sidebar's new amber
     * `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` badge: an asset with
     * `checkedOutQuantity > 0 && dispositionedQuantity === 0` on an
     * active booking is "partly out, no returns yet".
     *
     * Legacy fallback: pre-progressive-checkout rows have
     * `quantities[].length !== assetIds[].length` (often empty). We
     * count one unit per occurrence in that case, matching the
     * service-layer read convention (`countCheckedOutUnitsForAsset` in
     * `apps/webapp/app/modules/booking/service.server.ts`).
     */
    const checkoutSessionRows =
      bookingIdsOnPage.length > 0
        ? await db.partialBookingCheckout.findMany({
            where: { bookingId: { in: bookingIdsOnPage } },
            select: { bookingId: true, assetIds: true, quantities: true },
          })
        : [];
    const checkedOutByBooking: Record<string, Record<string, number>> = {};
    for (const session of checkoutSessionRows) {
      const ids = session.assetIds ?? [];
      const qtys = session.quantities ?? [];
      const aligned = qtys.length === ids.length;
      const bucket =
        checkedOutByBooking[session.bookingId] ??
        (checkedOutByBooking[session.bookingId] = {});
      for (let i = 0; i < ids.length; i += 1) {
        const assetId = ids[i];
        const quantity = aligned ? qtys[i] ?? 1 : 1;
        bucket[assetId] = (bucket[assetId] ?? 0) + quantity;
      }
    }

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
        dispositionedByBooking,
        dispositionBreakdownByBooking,
        checkedOutByBooking,
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
