import { BookingStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
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
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1", 10) || 1
    );
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("perPage") || "20", 10) || 20)
    );

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

    const where = {
      organizationId,
      status: { in: statusFilter },
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
            select: { bookingAssets: true },
          },
        },
        orderBy: [{ from: "asc" }],
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
