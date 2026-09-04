import { BookingStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  bookingDraftVisibilityClause,
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { resolveUserDisplayName } from "~/utils/user";

/**
 * GET /api/mobile/bookings
 *
 * Returns paginated bookings for the user's organization.
 * Query params:
 *   - orgId (required): organization ID
 *   - status (optional): filter by booking status (comma-separated)
 *   - page (optional): page number (default 1)
 *   - perPage (optional): items per page (default 20, max 50)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1", 10) || 1
    );
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("perPage") || "20", 10) || 20)
    );

    // Sort: allowlisted column + direction (mirrors the web list's sortable
    // columns). Defaults to the original `from asc` so existing callers are
    // unaffected. The allowlist prevents arbitrary Prisma orderBy injection.
    const SORTABLE = ["from", "to", "name", "createdAt"] as const;
    const sortByParam = url.searchParams.get("sortBy") || "";
    const sortBy = (SORTABLE as readonly string[]).includes(sortByParam)
      ? (sortByParam as (typeof SORTABLE)[number])
      : "from";
    const sortOrder =
      url.searchParams.get("sortOrder") === "desc" ? "desc" : "asc";

    // Build status filter
    const validStatuses = Object.values(BookingStatus);
    let statusFilter: BookingStatus[] | undefined;
    if (statusParam) {
      const requested = statusParam.split(",").map((s) => s.trim());
      const valid = requested.filter((s) =>
        validStatuses.includes(s as BookingStatus)
      ) as BookingStatus[];
      if (valid.length > 0) {
        statusFilter = valid;
      }
    }

    // Default: show active bookings (not archived/cancelled)
    if (!statusFilter) {
      statusFilter = [
        BookingStatus.DRAFT,
        BookingStatus.RESERVED,
        BookingStatus.ONGOING,
        BookingStatus.OVERDUE,
        BookingStatus.COMPLETE,
      ];
    }

    /**
     * Two independent questions, two independent workspace overrides.
     *
     * `canSeeAllBookings` decides WHICH ROWS exist for this caller: ADMIN and
     * OWNER see every booking, SELF_SERVICE and BASE see only their own unless
     * the workspace has switched their override on. Resolve it here, never
     * from the role alone - the role does not know what the workspace decided.
     *
     * `canSeeAllCustody` decides whether the custodian's NAME may be shown on
     * a row that already exists. A workspace may grant either without the
     * other, so never let one stand in for the other.
     */
    const { canSeeAllBookings, canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );

    /**
     * Custodian scope (web parity). Web matches a self-service or base user's
     * bookings through their user link OR any of their team-member links -
     * `custodianScopeClause`, fed by `resolveCustodianScope`. Mobile matched
     * only the user link, so a booking whose custodian was assigned by picking
     * a TEAM MEMBER rather than a user was visible on the website and missing
     * from the phone, for the very user it belonged to.
     */
    const custodianScope = canSeeAllBookings
      ? null
      : await resolveCustodianScope({ userId: user.id, organizationId });

    const where = {
      organizationId,
      status: { in: statusFilter },
      /**
       * Draft privacy (web parity). A DRAFT booking is private to whoever
       * created it — web enforces this in `getBookings`, the slim picker list
       * and the CSV export via this same shared clause. Mobile applied it
       * nowhere, so every user saw every colleague's unfinished drafts.
       *
       * AND-ed rather than merged into the search `OR` below: an OR at this
       * level would widen the search clause instead of restricting it.
       */
      AND: [
        bookingDraftVisibilityClause(user.id),
        ...(custodianScope ? [custodianScopeClause(custodianScope)] : []),
      ],
      // Keyword search over booking name + description (the field-tech "find my
      // booking" case). Web also searches tags/custodian/asset names; name +
      // description covers the common case without a heavier query.
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
    };

    /**
     * The custodian chip is visible when the workspace grants custody
     * visibility, or when the custodian IS the caller through either custody
     * link. Web decides it with `userCanViewSpecificCustody`; keep the two in
     * step, or the same booking names its holder on one platform and not the
     * other.
     */
    const canSeeCustodianOf = (booking: {
      custodianUser: { id: string } | null;
      custodianTeamMember: { userId: string | null } | null;
    }) =>
      canSeeAllCustody ||
      booking.custodianUser?.id === user.id ||
      booking.custodianTeamMember?.userId === user.id;

    const [bookings, totalCount] = await Promise.all([
      db.booking.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          from: true,
          to: true,
          createdAt: true,
          custodianUser: {
            select: {
              // Select `id` here and `userId` on the team member below:
              // together they answer "is the custodian the caller?", which is
              // what keeps a restricted user's own name visible to them.
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
            },
          },
          custodianTeamMember: {
            select: { name: true, userId: true },
          },
          _count: {
            select: {
              bookingAssets: true,
              // Outstanding book-by-model reservations (units reserved but not
              // yet assigned to concrete assets). Lets the list card tell a
              // "reserved but nothing physical to check out yet" booking apart
              // from a genuinely check-out-ready one, so it never mislabels a
              // model-only reservation as "Ready to check out".
              modelRequests: { where: { fulfilledAt: null } },
            },
          },
          // The outstanding rows themselves, so the card can report UNITS
          // reserved rather than how many model rows hold them. `_count` above
          // answers "is anything outstanding?"; this answers "how much?", which
          // is what the fulfil banner already shows ("Tablecloth x2") and what
          // the operator is actually going to carry. Two scalars per row, and
          // most bookings have none.
          modelRequests: {
            where: { fulfilledAt: null },
            select: { quantity: true, fulfilledQuantity: true },
          },
        },
        orderBy: [{ [sortBy]: sortOrder }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.booking.count({ where }),
    ]);

    return data({
      bookings: bookings.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        from: b.from,
        to: b.to,
        createdAt: b.createdAt,
        // Three distinct answers, and the app renders each differently:
        // a name, null for "this booking has no custodian", and "private" for
        // "it has one you may not see" - the word web draws in place of the
        // badge (`TeamMemberBadge`). Collapsing the last two would report an
        // unassigned booking as a withheld one.
        custodianName:
          !b.custodianTeamMember && !b.custodianUser
            ? null
            : canSeeCustodianOf(b)
            ? b.custodianTeamMember?.name ||
              resolveUserDisplayName(b.custodianUser) ||
              null
            : "private",
        custodianImage: canSeeCustodianOf(b)
          ? b.custodianUser?.profilePicture || null
          : null,
        assetCount: b._count.bookingAssets,
        // Outstanding book-by-model reservations still to assign. > 0 means the
        // booking holds reserved units with no concrete assets behind them yet.
        outstandingModelCount: b._count.modelRequests,
        // Units still to assign across those reservations. Mirrors
        // `outstandingModelUnitCount` on the booking detail endpoint so both
        // surfaces name and count the same thing.
        outstandingModelUnitCount: b.modelRequests.reduce(
          (sum, mr) => sum + Math.max(0, mr.quantity - mr.fulfilledQuantity),
          0
        ),
      })),
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
