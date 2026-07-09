import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

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

    // Scope to the caller's own bookings for self-service / base users, who
    // can only see the bookings they are the custodian of (web parity — see
    // getBookings' `isSelfServiceOrBase` branch). Owners/admins see all. This
    // matters especially now that DRAFT bookings appear in the default view.
    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    const where = {
      organizationId,
      status: { in: statusFilter },
      ...(isSelfServiceOrBase && { custodianUserId: user.id }),
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
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          custodianTeamMember: {
            select: { name: true },
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
        custodianName:
          b.custodianTeamMember?.name ||
          [b.custodianUser?.firstName, b.custodianUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          null,
        custodianImage: b.custodianUser?.profilePicture || null,
        assetCount: b._count.bookingAssets,
        // Outstanding book-by-model reservations still to assign. > 0 means the
        // booking holds reserved units with no concrete assets behind them yet.
        outstandingModelCount: b._count.modelRequests,
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
