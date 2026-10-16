import { BookingStatus, type Prisma } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobilePagination } from "~/modules/api/mobile-pagination";
import {
  buildBookingsWhere,
  getBookingsListWhereParams,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import { resolveBookingCustodianName } from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * GET /api/mobile/assets/:assetId/bookings
 *
 * The bookings one asset appears in: the phone's answer to "when is this out,
 * and where has it been?", asked while standing in front of it.
 *
 * Which bookings the list holds is decided by the web asset page's Bookings tab
 * (`getBookingsListWhereParams` with an asset list, then `buildBookingsWhere`),
 * so the phone and the web always agree. That covers the organization, the
 * tab's statuses (every status but ARCHIVED and CANCELLED), draft privacy, and
 * the custodian scope for members without `access.bookings.seeAll`. The
 * custodian's name follows `access.custody.seeAll`, a separate workspace
 * override.
 *
 * Two lists come back:
 *   - `bookings`: one page of every booking, newest start first
 *   - `activeBookings`: the ONGOING and OVERDUE ones, whatever page they fall
 *     on, so a preview can lead with the booking the asset is out on now even
 *     when future reservations fill the first page
 *
 * Query params:
 *   - orgId (required): organization ID
 *   - page (optional): page number (default 1)
 *   - perPage (optional): items per page (default 20, max 50)
 *
 * @see {@link file://./bookings.ts} the workspace-wide list
 * @see {@link file://./../../_layout+/assets.$assetId.bookings.tsx} web's tab
 */

/** Upper bound on `activeBookings`; a quantity-tracked pool can be out on several. */
const ACTIVE_BOOKINGS_LIMIT = 10;

/** The statuses that mean the asset is out on the booking right now. */
const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * The columns a row needs. `custodianUser.id` and `custodianTeamMember.userId`
 * answer "is the custodian the caller?", which keeps a restricted user's own
 * name visible to them.
 */
const BOOKING_ROW_SELECT = {
  id: true,
  name: true,
  status: true,
  from: true,
  to: true,
  custodianUser: {
    select: { id: true, firstName: true, lastName: true, displayName: true },
  },
  custodianTeamMember: { select: { name: true, userId: true } },
} satisfies Prisma.BookingSelect;

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Reading an asset's bookings is a booking read, gated like the list.
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const assetId = params.assetId;
    if (!assetId) {
      throw new ShelfError({
        cause: null,
        message: "Asset id is required.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // Prove the asset is in this workspace before reporting anything about it,
    // so a guessed id from another org cannot be probed through this route.
    const asset = await db.asset.findFirst({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: the asset's own screen shows archived assets, and their booking history with them
      where: { id: assetId, organizationId },
      select: { id: true },
    });

    if (!asset) {
      return data(
        { error: { message: "Asset not found in this workspace." } },
        { status: 404 }
      );
    }

    const { page, perPage, skip } = parseMobilePagination(
      new URL(request.url).searchParams
    );

    /**
     * `access.bookings.seeAll` decides WHICH ROWS exist for this caller,
     * `access.custody.seeAll` whether a row may name its custodian. A workspace
     * may grant either without the other, so neither stands in for the other.
     */
    const { access } = await getMobileUserContext(user.id, organizationId);

    const custodianScope = access.bookings.seeAll
      ? null
      : await resolveCustodianScope({ userId: user.id, organizationId });

    // No URL filters: the phone shows the tab's default view.
    const listParams = getBookingsListWhereParams({
      list: { kind: "asset", assetId },
      searchParams: new URLSearchParams(),
      organizationId,
      userId: user.id,
      custodianScope,
    });
    const where = buildBookingsWhere(listParams);
    const activeWhere = buildBookingsWhere({
      ...listParams,
      statuses: ACTIVE_STATUSES,
    });

    const [bookings, activeBookings, totalCount] = await Promise.all([
      db.booking.findMany({
        where,
        select: BOOKING_ROW_SELECT,
        /**
         * Newest start first, unlike the web tab's ascending default: the
         * phone previews a few rows, and ascending would fill them with an
         * asset's oldest history. `activeBookings` covers the booking that is
         * out now, which this order can push off the first rows.
         */
        orderBy: [{ from: "desc" }],
        skip,
        take: perPage,
      }),
      db.booking.findMany({
        where: activeWhere,
        select: BOOKING_ROW_SELECT,
        orderBy: [{ from: "asc" }],
        take: ACTIVE_BOOKINGS_LIMIT,
      }),
      db.booking.count({ where }),
    ]);

    /** One row as the companion's `AssetBookingRow` reads it. */
    const toRow = (b: (typeof bookings)[number]) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      from: b.from,
      to: b.to,
      // Shared with the bookings list and the calendar: a name, null for "no
      // custodian", or the withheld sentinel.
      custodianName: resolveBookingCustodianName({
        canSeeAllCustody: access.custody.seeAll,
        booking: b,
        userId: user.id,
      }),
    });

    return data({
      bookings: bookings.map(toRow),
      activeBookings: activeBookings.map(toRow),
      page,
      perPage,
      totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
