import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  bookingDraftVisibilityClause,
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import { resolveMostPrivilegedRole } from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { resolveUserDisplayName } from "~/utils/user";

/** Hard ceiling on the window a single call may ask for. */
const MAX_RANGE_DAYS = 366;

/**
 * Most bookings one window will answer with.
 *
 * A month for a busy workspace is unbounded otherwise, and this may be pulled
 * over site data. Hitting it is REPORTED rather than silent: rows are ordered
 * by start date, so a quiet truncation drops the END of the window and the last
 * week of the month renders empty while looking perfectly healthy.
 */
const MAX_BOOKINGS_PER_WINDOW = 500;

/**
 * GET /api/mobile/bookings/calendar
 *
 * Bookings OVERLAPPING a date window, for the companion's calendar view.
 *
 * Asked for by rental operations who need to see upcoming bookings across
 * weeks and months. Web has had a calendar since long before the app; the
 * phone had no way to see bookings laid out over time.
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

    /**
     * why no `assertMobileCanUseBookings` here: it is a workspace-TYPE gate that
     * 403s a personal workspace, and the bookings LIST this view shares a screen
     * with does not apply it. Gating one lens and not the other meant tapping
     * the calendar replaced the day panel with a raw server string and left no
     * way back except switching lens. Web draws the same line - reads are open
     * and the gate sits on the WRITE paths (`bookings.create`, calendar
     * subscription, CSV export), which keep it.
     */
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
    /**
     * Askable statuses. Archived and cancelled are in here because the "All"
     * pill asks for them and the list answers with them: dropping them here
     * silently made one pill mean two different things depending on which lens
     * you were in. Web behaves the same way - its calendar excludes them by
     * DEFAULT but honours an explicit status filter.
     */
    const ALLOWED = [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
      BookingStatus.COMPLETE,
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
    ];

    /**
     * What you get when nothing is asked for, matching web's `getBookings`:
     * archived and cancelled are noise until you go looking for them.
     */
    const DEFAULT_STATUSES = [
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
    const statuses = requested.length > 0 ? requested : DEFAULT_STATUSES;

    /**
     * Clamped to the same 100 characters the list route applies. Unbounded, this
     * term reaches four separate `contains` predicates per request, so a large
     * value costs several unbounded pattern matches over the booking table.
     */
    const search =
      url.searchParams.get("search")?.trim().slice(0, 100) || undefined;

    /**
     * `roles`, resolved to the most privileged one - NOT the context's `role`,
     * which is `roles[0]`. A membership stored `[SELF_SERVICE, ADMIN]` resolves
     * to SELF_SERVICE there, so a genuine admin was narrowed to bookings they
     * are custodian of and every colleague's booking vanished from the grid
     * while the list lens still showed them. The sibling mobile booking routes
     * all resolve it this way.
     */
    const { roles } = await getMobileUserContext(user.id, organizationId);
    const role = resolveMostPrivilegedRole(roles);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    const custodianScope = isSelfServiceOrBase
      ? await resolveCustodianScope({ userId: user.id, organizationId })
      : null;

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
      /**
       * Custodian scope (web parity). Web matches a self-service or base user's
       * bookings through their user link OR any of their team-member links -
       * `custodianScopeClause`, fed by `resolveCustodianScope`. Mobile matched
       * only the user link, so a booking whose custodian was assigned by
       * picking a TEAM MEMBER rather than a user was visible on the website and
       * missing from the phone, for the very user it belonged to.
       */
      AND: [
        bookingDraftVisibilityClause(user.id),
        ...(custodianScope ? [custodianScopeClause(custodianScope)] : []),
      ],
    };

    // Overlap, not containment: a job running 28 Jul to 3 Aug belongs in August.
    const overlapsWindow = { from: { lte: end }, to: { gte: start } };
    const outsideWindow = {
      ...baseWhere,
      NOT: { AND: [{ from: { lte: end } }, { to: { gte: start } }] },
    };

    const rows = await db.booking.findMany({
      where: { ...baseWhere, ...overlapsWindow },
      /**
       * Exactly what a band and a day-panel row render, and nothing else. An
       * asset count and a custodian avatar were selected and shipped but never
       * drawn; the count in particular cost a correlated subquery on every one
       * of these rows, on a phone that may be on site data.
       */
      select: {
        id: true,
        name: true,
        status: true,
        from: true,
        to: true,
        custodianUser: {
          select: { firstName: true, lastName: true, displayName: true },
        },
        custodianTeamMember: { select: { name: true } },
      },
      // Soonest first: a calendar is read forwards.
      orderBy: [{ from: "asc" }],
      // One past the ceiling, purely to learn whether there IS more. The extra
      // row is dropped below and never reaches the client.
      take: MAX_BOOKINGS_PER_WINDOW + 1,
    });

    /**
     * why this is reported and not swallowed: the rows are ordered by start
     * date, so truncation removes the END of the window. The last week of the
     * month would render with no bands at all and the day panel would answer
     * "Nothing booked on this day" for days that are fully booked. The counts
     * below cannot cover it either - these rows DO overlap the window, so they
     * are not "outside" it.
     */
    const truncated = rows.length > MAX_BOOKINGS_PER_WINDOW;
    const bookings = truncated ? rows.slice(0, MAX_BOOKINGS_PER_WINDOW) : rows;

    /**
     * How much this filter matches beyond the visible month, and where to look.
     * Only these can answer "where did my bookings go" when the month on screen
     * is empty.
     *
     * The forward lookup rides the `(organizationId, from, id)` index. The
     * backward one orders by `to`, which has NO index, so it is deliberately not
     * run alongside: its result is discarded whenever anything lies ahead, which
     * is the ordinary case for a calendar. Paying for it only when the answer is
     * actually needed costs one extra round trip on the rare empty-ahead path
     * instead of a full sort of the org's history on every month swipe.
     */
    const [outsideCount, nextUp] = await Promise.all([
      db.booking.count({ where: outsideWindow }),
      db.booking.findFirst({
        where: { ...baseWhere, from: { gt: end } },
        orderBy: { from: "asc" },
        select: { from: true },
      }),
    ]);

    // `to`, not `from`: this is ordered by the nearest END behind the window, so
    // returning its start sent the calendar to whenever that booking began -
    // which for a long booking can be years before the month it was chosen for.
    const previous = nextUp
      ? null
      : await db.booking.findFirst({
          where: { ...baseWhere, to: { lt: start } },
          orderBy: { to: "desc" },
          select: { to: true },
        });

    return data({
      bookings: bookings.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        from: b.from,
        to: b.to,
        custodianName:
          b.custodianTeamMember?.name ||
          resolveUserDisplayName(b.custodianUser) ||
          null,
      })),
      /**
       * True when this window holds more than one response may carry, so the
       * view can say the later part of the month is incomplete rather than
       * drawing it as empty.
       */
      truncated,
      /**
       * Bookings matching the same filter that this month does not show.
       * `jumpTo` prefers the next one forward, since a calendar is read
       * forwards, and falls back to the most recent one behind.
       */
      outsideWindow: {
        count: outsideCount,
        jumpTo: nextUp?.from ?? previous?.to ?? null,
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
