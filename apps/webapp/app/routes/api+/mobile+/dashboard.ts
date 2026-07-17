import { OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { getBookings } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/dashboard
 *
 * Returns all dashboard data in a single request:
 * - KPI counts (assets, categories, locations, team members)
 * - Assets by status breakdown
 * - My custody count
 * - Upcoming bookings (RESERVED)
 * - Active bookings (ONGOING)
 * - Overdue bookings (OVERDUE)
 * - Newest assets (5)
 * - Active audits (PENDING or ACTIVE, up to 5)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Server-enforce the paid Audits add-on via the canonical helper
    // (canUseAudits, surfaced through getMobileUserContext) so the
    // dashboard never serves activeAudits to non-add-on workspaces — a
    // paywall bypass / data leak even with the client cards hidden.
    // The same call yields the caller's `role`, which gates booking
    // visibility below.
    const { canUseAudits, role } = await getMobileUserContext(
      user.id,
      organizationId
    );

    // Scope the booking sections to the caller's own bookings for
    // self-service / base users, who may only see bookings they are the
    // custodian of. `requireOrganizationAccess` above proves membership but
    // performs NO role check, so without this restriction any member could
    // read every booking in the workspace — with custodian names attached —
    // straight off the dashboard.
    //
    // Mirrors the mobile bookings list (`bookings.ts`), which draws the same
    // line for the same roles. Passed as `custodianScope` — a restriction
    // `getBookings` ANDs into the query, so it can only ever narrow. Left
    // `null` for owners/admins, who see all bookings.
    //
    // NOTE: this deliberately does not mirror the web dashboard, which denies
    // self-service/base the page outright (`PermissionEntity.dashboard` is
    // empty for both). The companion's Home tab is the app's landing screen
    // for every role, not an admin analytics surface — denying it would leave
    // those users on a permanent error state rather than a scoped dashboard.
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;
    const custodianScope = isSelfServiceOrBase ? { userId: user.id } : null;

    // Run all queries in parallel for speed
    const [
      totalAssets,
      categoryCount,
      locationCount,
      teamMemberCount,
      assetsByStatus,
      myCustodyCount,
      newestAssets,
      upcomingBookingsResult,
      activeBookingsResult,
      overdueBookingsResult,
      activeAudits,
    ] = await Promise.all([
      // KPI: Total assets
      db.asset.count({ where: { organizationId } }),

      // KPI: Categories
      db.category.count({ where: { organizationId } }),

      // KPI: Locations
      db.location.count({ where: { organizationId } }),

      // KPI: Team members (active)
      db.teamMember.count({
        where: { organizationId, deletedAt: null },
      }),

      // Assets by status
      db.asset.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { id: true },
      }),

      // My custody count — assets currently in custody of this user.
      // Phase 2 widened `Asset.custody` from 1:1 to 1:many for
      // QUANTITY_TRACKED multi-custodian support, so we filter via `some`.
      db.asset.count({
        where: {
          organizationId,
          custody: {
            some: {
              custodian: {
                userId: user.id,
              },
            },
          },
        },
      }),

      // 5 newest assets
      db.asset.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          mainImage: true,
          category: { select: { id: true, name: true, color: true } },
          createdAt: true,
        },
      }),

      // Upcoming bookings (RESERVED)
      getBookings({
        organizationId,
        page: 1,
        perPage: 5,
        statuses: ["RESERVED"],
        userId: user.id,
        custodianScope,
        bookingFrom: new Date(),
        extraInclude: {
          custodianUser: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          custodianTeamMember: { select: { name: true } },
        },
      }),

      // Active bookings (ONGOING)
      getBookings({
        organizationId,
        page: 1,
        perPage: 5,
        statuses: ["ONGOING"],
        userId: user.id,
        custodianScope,
        extraInclude: {
          custodianUser: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          custodianTeamMember: { select: { name: true } },
        },
      }),

      // Overdue bookings
      getBookings({
        organizationId,
        page: 1,
        perPage: 5,
        statuses: ["OVERDUE"],
        userId: user.id,
        custodianScope,
        extraInclude: {
          custodianUser: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          custodianTeamMember: { select: { name: true } },
        },
      }),

      // Active audits (PENDING or ACTIVE) — gated on the Audits add-on.
      // Empty `id: { in: [] }` yields no rows for non-add-on workspaces,
      // so the dashboard never serializes audit data without the add-on.
      db.auditSession.findMany({
        where: {
          organizationId,
          status: { in: ["PENDING", "ACTIVE"] },
          ...(canUseAudits ? {} : { id: { in: [] } }),
        },
        select: {
          id: true,
          name: true,
          status: true,
          expectedAssetCount: true,
          foundAssetCount: true,
          dueDate: true,
          // why: surface ownership on the dashboard's audit cards the same
          // way the audits list does — `assigneeCount` distinguishes
          // "Unassigned · anyone can scan" (0) from an owned audit, and
          // `assignments.userId` lets the client mark the caller's own work
          // ("Assigned to you"). Mirrors `apps/webapp/app/routes/api+/mobile+/audits.ts`.
          _count: { select: { assignments: true } },
          assignments: { select: { userId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    // Format assets by status into a simple map
    const statusCounts: Record<string, number> = {};
    for (const group of assetsByStatus) {
      statusCounts[group.status] = group._count.id;
    }

    // Format booking results
    const formatBooking = (b: any) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      from: b.from?.toISOString?.() ?? b.from,
      to: b.to?.toISOString?.() ?? b.to,
      custodianName: b.custodianUser
        ? [b.custodianUser.firstName, b.custodianUser.lastName]
            .filter(Boolean)
            .join(" ") || null
        : b.custodianTeamMember?.name || null,
      assetCount: b._count?.assets ?? 0,
    });

    return data({
      kpis: {
        totalAssets,
        categories: categoryCount,
        locations: locationCount,
        teamMembers: teamMemberCount,
        myCustody: myCustodyCount,
      },
      assetsByStatus: statusCounts,
      newestAssets: newestAssets.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        mainImage: a.mainImage,
        category: a.category,
        createdAt: a.createdAt.toISOString(),
      })),
      upcomingBookings: upcomingBookingsResult.bookings.map(formatBooking),
      activeBookings: activeBookingsResult.bookings.map(formatBooking),
      overdueBookings: overdueBookingsResult.bookings.map(formatBooking),
      activeAudits: activeAudits.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        expectedAssetCount: a.expectedAssetCount,
        foundAssetCount: a.foundAssetCount,
        dueDate: a.dueDate?.toISOString() ?? null,
        assigneeCount: a._count?.assignments ?? 0,
        // `userId` here is the assignee on each AuditAssignment; compare to
        // the caller (user.id) to flag the caller's own audits.
        isAssignedToMe:
          a.assignments?.some((assn) => assn.userId === user.id) ?? false,
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
