import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  assertMobileCanUseBookings,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { bookingDraftVisibilityClause } from "~/modules/booking/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/** Hard ceiling on the window a single call may ask for. */
const MAX_RANGE_DAYS = 366;

/**
 * GET /api/mobile/bookings/calendar
 *
 * Bookings OVERLAPPING a date window, for the companion's calendar view.
 *
 * Customer request (Richard Raiman, Raiman Production): "calendar view to have
 * a picture of upcomming bookings in the context of weeks / months". Web has
 * had a calendar since long before the app; the phone has no way to see
 * bookings laid out over time.
 *
 * Deliberately NOT `getBookingsForCalendar`: that service shapes its output for
 * FullCalendar, down to CSS class names, which is web rendering detail the app
 * cannot use. The SCOPING is what matters and is mirrored exactly from the
 * mobile bookings list:
 *   - organisation scoped
 *   - SELF_SERVICE / BASE see only bookings they are custodian of
 *   - DRAFT bookings stay private to their creator
 *
 * Overlap, not containment: a booking running 28 Jul to 3 Aug belongs on the
 * August calendar too. Filtering on `from` alone would hide it.
 *
 * Query params:
 *   - orgId (required): organization ID
 *   - start (required): ISO date, inclusive window start
 *   - end   (required): ISO date, inclusive window end
 *
 * @see {@link file://./bookings.ts} the list whose scoping this mirrors
 * @see {@link file://./../../_layout+/calendar.tsx} web's calendar
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    await assertMobileCanUseBookings(organizationId);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    if (!startParam || !endParam) {
      throw new ShelfError({
        cause: null,
        message: "Both start and end are required.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const start = new Date(startParam);
    const end = new Date(endParam);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ShelfError({
        cause: null,
        message: "start and end must be valid dates.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (end < start) {
      throw new ShelfError({
        cause: null,
        message: "end must be on or after start.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // why: the window is client-supplied, and a calendar that swipes fast can
    // ask for a lot. Cap it so one request cannot pull an org's whole history.
    const rangeDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new ShelfError({
        cause: null,
        message: `Date range must be ${MAX_RANGE_DAYS} days or fewer.`,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    /**
     * Status + search come from the same controls the list uses, so the lens
     * and the filter compose. Web applies its whole filter set to the calendar
     * too; without this, a filter set in list mode was silently dropped the
     * moment the user switched lens, and the two views disagreed by default.
     *
     * Unknown status values are ignored rather than rejected: the client sends
     * a comma-joined pill value, and a stale app build must not hard-fail.
     */
    const ALLOWED = [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
      BookingStatus.COMPLETE,
    ];
    const requested = (url.searchParams.get("statuses") ?? "")
      .split(",")
      .map((v) => v.trim().toUpperCase())
      .filter((v): v is (typeof ALLOWED)[number] =>
        ALLOWED.includes(v as (typeof ALLOWED)[number])
      );
    const statuses = requested.length > 0 ? requested : ALLOWED;

    const search = url.searchParams.get("search")?.trim() || undefined;

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    /**
     * Everything except the date window, so the same filter can also answer the
     * opposite question: what matches but falls OUTSIDE the month on screen.
     *
     * why that question matters: the bookings LIST is date-blind. "Active"
     * shows every open booking whenever it falls. The calendar is scoped to one
     * month, so switching lens could make four bookings vanish with nothing
     * saying where they went. The counts below let the screen say so.
     */
    const baseWhere = {
      organizationId,
      status: { in: statuses },
      // Same name/description keyword match the mobile list applies.
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              {
                description: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
      ...(isSelfServiceOrBase && { custodianUserId: user.id }),
      AND: [bookingDraftVisibilityClause(user.id)],
    };

    // Overlap, not containment: a job running 28 Jul to 3 Aug belongs in August.
    const overlapsWindow = { from: { lte: end }, to: { gte: start } };
    const outsideWindow = {
      ...baseWhere,
      NOT: { AND: [{ from: { lte: end } }, { to: { gte: start } }] },
    };

    const bookings = await db.booking.findMany({
      where: { ...baseWhere, ...overlapsWindow },
      select: {
        id: true,
        name: true,
        status: true,
        from: true,
        to: true,
        custodianUser: {
          select: { firstName: true, lastName: true, profilePicture: true },
        },
        custodianTeamMember: { select: { name: true } },
        _count: { select: { bookingAssets: true } },
      },
      // Soonest first: a calendar is read forwards.
      orderBy: [{ from: "asc" }],
      // why: a month for a busy workspace is unbounded otherwise. The grid can
      // only show a few bands per day anyway, so a ceiling costs nothing that
      // is visible and stops one request pulling an enormous payload onto a
      // phone that may be on site data.
      take: 500,
    });

    /**
     * How much this filter matches beyond the visible month, and where to look.
     * Two cheap indexed lookups, and only they can answer "where did my
     * bookings go" when the month on screen is empty.
     */
    const [outsideCount, nextUp, previous] = await Promise.all([
      db.booking.count({ where: outsideWindow }),
      db.booking.findFirst({
        where: { ...baseWhere, from: { gt: end } },
        orderBy: { from: "asc" },
        select: { from: true },
      }),
      db.booking.findFirst({
        where: { ...baseWhere, to: { lt: start } },
        orderBy: { to: "desc" },
        select: { from: true },
      }),
    ]);

    return data({
      bookings: bookings.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        from: b.from,
        to: b.to,
        assetCount: b._count.bookingAssets,
        custodianName:
          b.custodianTeamMember?.name ||
          [b.custodianUser?.firstName, b.custodianUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          null,
        custodianImage: b.custodianUser?.profilePicture || null,
      })),
      /**
       * Bookings matching the same filter that this month does not show.
       * `jumpTo` prefers the next one forward, since a calendar is read
       * forwards, and falls back to the most recent one behind.
       */
      outsideWindow: {
        count: outsideCount,
        jumpTo: nextUp?.from ?? previous?.from ?? null,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
