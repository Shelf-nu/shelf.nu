import type {
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "react-router";
import { data, Link, useLoaderData } from "react-router";
import AnnouncementBar from "~/components/dashboard/announcement-bar";
import AssetsByStatusChart from "~/components/dashboard/assets-by-status-chart";
import OnboardingChecklist from "~/components/dashboard/checklist";
import CustodiansList from "~/components/dashboard/custodians";
import InventoryValueChart from "~/components/dashboard/inventory-value-chart";
import NewestAssets from "~/components/dashboard/newest-assets";
import { ErrorContent } from "~/components/errors";
import ActiveBookings from "~/components/home/active-bookings";
import AssetGrowthChart from "~/components/home/asset-growth-chart";
import KpiCards from "~/components/home/kpi-cards";
import LocationDistribution from "~/components/home/location-distribution";
import OverdueBookings from "~/components/home/overdue-bookings";
import UpcomingBookings from "~/components/home/upcoming-bookings";
import UpcomingReminders from "~/components/home/upcoming-reminders";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { db } from "~/database/db.server";
import { count, findFirst } from "~/database/query-helpers.server";
import { queryRaw, sql } from "~/database/sql.server";
import { getUpcomingRemindersForHomePage } from "~/modules/asset-reminder/service.server";
import { getBookings } from "~/modules/booking/service.server";

import styles from "~/styles/layout/skeleton-loading.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getLocale } from "~/utils/client-hints";
import { userPrefs } from "~/utils/cookies.server";
import {
  buildAssetsByStatusChart,
  buildMonthlyGrowthData,
  checklistOptions,
  getCustodiansOrderedByTotalCustodies,
} from "~/utils/dashboard.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.dashboard,
      action: PermissionAction.read,
    });

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    // Fetch all data in parallel — targeted queries instead of loading all assets
    const [
      // 1a. Aggregated asset stats
      aggResult,
      valueKnownAssets,
      // 1b. Assets by status
      statusGroupRows,
      // 1c. Monthly growth data
      monthlyRows,
      baselineResult,
      // 1d. Top custodians (direct custody)
      directCustodianRows,
      // 1d. Bookings for custodian merge (ongoing + overdue)
      { bookings: ongoingAndOverdueBookings },
      // Upcoming bookings
      { bookings: upcomingBookings },
      // Overdue bookings
      { bookings: overdueBookings },
      // Active/ongoing bookings
      { bookings: activeBookings },
      // 1e. Newest 5 assets
      newAssetRows,
      // Upcoming reminders
      upcomingReminders,
      // Announcement
      announcement,
      // KPI counts
      teamMembersCount,
      locationDistRows,
      locationsCount,
      categoriesCount,
      // Cookie
      cookieResult,
    ] = await Promise.all([
      // 1a. Asset count + total valuation
      queryRaw<{ count: number; total_valuation: number }>(
        db,
        sql`SELECT COUNT(*)::int as "count", COALESCE(SUM("valuation"), 0) as "total_valuation"
            FROM "Asset"
            WHERE "organizationId" = ${organizationId}`
      ).catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load asset aggregation",
          additionalData: { userId, organizationId },
          label: "Dashboard",
        });
      }),

      // 1a. Count of assets with known valuation
      count(db, "Asset", { organizationId, valuation: { not: null } }),

      // 1b. Assets grouped by status
      queryRaw<{ status: string; count: number }>(
        db,
        sql`SELECT "status", COUNT(*)::int as "count"
            FROM "Asset"
            WHERE "organizationId" = ${organizationId}
            GROUP BY "status"`
      ),

      // 1c. Monthly asset creation counts (last 12 months)
      queryRaw<{ month_start: Date; assets_created: number }>(
        db,
        sql`SELECT date_trunc('month', "createdAt") AS month_start,
               COUNT(*)::int AS assets_created
          FROM "Asset"
          WHERE "organizationId" = ${organizationId}
            AND "createdAt" >= ${twelveMonthsAgo}
          GROUP BY 1
          ORDER BY 1`
      ),

      // 1c. Baseline count (assets before the 12-month window)
      queryRaw<{ count: number }>(
        db,
        sql`SELECT COUNT(*)::int as "count"
            FROM "Asset"
            WHERE "organizationId" = ${organizationId}
              AND "createdAt" < ${twelveMonthsAgo}`
      ),

      // 1d. Team members with direct custody counts
      queryRaw<{
        id: string;
        name: string;
        userId: string | null;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
        email: string | null;
        custodyCount: number;
      }>(
        db,
        sql`SELECT tm."id", tm."name", tm."userId",
               u."firstName", u."lastName", u."profilePicture", u."email",
               COUNT(c."id")::int as "custodyCount"
          FROM "TeamMember" tm
          LEFT JOIN "User" u ON u."id" = tm."userId"
          INNER JOIN "Custody" c ON c."teamMemberId" = tm."id"
          WHERE tm."organizationId" = ${organizationId}
          GROUP BY tm."id", tm."name", tm."userId",
                   u."firstName", u."lastName", u."profilePicture", u."email"
          ORDER BY "custodyCount" DESC
          LIMIT 20`
      ),

      // 1d. Ongoing + overdue bookings for custodian merge
      getBookings({
        organizationId,
        userId,
        page: 1,
        perPage: 1000,
        statuses: ["ONGOING", "OVERDUE"],
        extraInclude: {
          custodianTeamMember: true,
          custodianUser: true,
          _count: { select: { assets: true } },
        },
      }),

      // Upcoming bookings (RESERVED, starting from now)
      // Both bookingFrom and bookingTo are required for date filtering
      getBookings({
        organizationId,
        userId,
        page: 1,
        perPage: 5,
        statuses: ["RESERVED"],
        bookingFrom: new Date(),
        bookingTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        extraInclude: {
          custodianTeamMember: true,
          custodianUser: true,
          _count: { select: { assets: true } },
        },
      }),

      // Overdue bookings
      getBookings({
        organizationId,
        userId,
        page: 1,
        perPage: 5,
        statuses: ["OVERDUE"],
        extraInclude: {
          custodianTeamMember: true,
          custodianUser: true,
          _count: { select: { assets: true } },
        },
      }),

      // Active/ongoing bookings
      getBookings({
        organizationId,
        userId,
        page: 1,
        perPage: 5,
        statuses: ["ONGOING"],
        extraInclude: {
          custodianTeamMember: true,
          custodianUser: true,
          _count: { select: { assets: true } },
        },
      }),

      // 1e. Newest 5 assets
      queryRaw<{
        id: string;
        title: string;
        mainImage: string | null;
        mainImageExpiration: string | null;
        status: string;
        createdAt: string;
        categoryId: string | null;
        categoryName: string | null;
        categoryColor: string | null;
      }>(
        db,
        sql`SELECT a."id", a."title", a."mainImage", a."mainImageExpiration",
               a."status", a."createdAt",
               c."id" as "categoryId", c."name" as "categoryName",
               c."color" as "categoryColor"
          FROM "Asset" a
          LEFT JOIN "Category" c ON c."id" = a."categoryId"
          WHERE a."organizationId" = ${organizationId}
          ORDER BY a."createdAt" DESC
          LIMIT 5`
      ).catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load newest assets",
          additionalData: { userId, organizationId },
          label: "Dashboard",
        });
      }),

      // Upcoming reminders
      getUpcomingRemindersForHomePage({ organizationId }),

      // Announcement
      findFirst(db, "Announcement", {
        where: { published: true },
        orderBy: { createdAt: "desc" },
      }).catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load announcement",
          additionalData: { userId, organizationId },
          label: "Dashboard",
        });
      }),

      // KPI: team members
      count(db, "TeamMember", { organizationId, deletedAt: null }),

      // Location distribution (top 5)
      queryRaw<{
        locationId: string;
        locationName: string;
        assetCount: number;
      }>(
        db,
        sql`SELECT l."id" as "locationId", l."name" as "locationName",
               COUNT(a."id")::int as "assetCount"
          FROM "Location" l
          INNER JOIN "Asset" a ON a."locationId" = l."id"
          WHERE l."organizationId" = ${organizationId}
          GROUP BY l."id", l."name"
          ORDER BY "assetCount" DESC
          LIMIT 5`
      ),

      // KPI: total locations
      count(db, "Location", { organizationId }),

      // KPI: total categories
      count(db, "Category", { organizationId }),

      // Cookie
      userPrefs.parse(request.headers.get("Cookie")).then((c: any) => c || {}),
    ]);

    const totalAssets = aggResult[0]?.count ?? 0;
    const totalValuation = aggResult[0]?.total_valuation ?? 0;
    const baselineCount = baselineResult[0]?.count ?? 0;

    // Map status group rows to expected shape
    const statusGroups = statusGroupRows.map((r) => ({
      status: r.status,
      _count: { _all: r.count },
    }));

    // Map direct custodian rows to expected shape
    const directCustodians = directCustodianRows.map((r) => ({
      id: r.id,
      name: r.name,
      userId: r.userId,
      user: r.userId
        ? {
            firstName: r.firstName,
            lastName: r.lastName,
            profilePicture: r.profilePicture,
            email: r.email ?? "",
          }
        : null,
      _count: { custodies: r.custodyCount },
    }));

    // Map newest asset rows to expected shape with nested category
    const newAssets = newAssetRows.map((r) => ({
      ...r,
      category: r.categoryId
        ? {
            id: r.categoryId,
            name: r.categoryName,
            color: r.categoryColor,
          }
        : null,
    }));

    // Location distribution already in correct shape from queryRaw
    const locationDistribution = locationDistRows;

    const header: HeaderData = {
      title: "Home",
    };

    return payload({
      header,
      // KPI data
      totalAssets,
      teamMembersCount,
      locationsCount,
      categoriesCount,
      // Widget data
      upcomingBookings,
      overdueBookings,
      activeBookings,
      upcomingReminders,
      locationDistribution,
      // Existing dashboard data
      locale: getLocale(request),
      currency: currentOrganization?.currency,
      totalValuation,
      valueKnownAssets,
      newAssets,
      skipOnboardingChecklist: cookieResult.skipOnboardingChecklist,
      custodiansData: getCustodiansOrderedByTotalCustodies({
        directCustodians,
        bookings: ongoingAndOverdueBookings as any,
      }),
      assetsByStatus: buildAssetsByStatusChart(statusGroups),
      assetGrowthData: buildMonthlyGrowthData(monthlyRows, baselineCount),
      announcement: announcement
        ? {
            ...announcement,
            content: parseMarkdownToReact(announcement.content),
          }
        : null,
      checklistOptions: await checklistOptions({
        hasAssets: totalAssets > 0,
        organizationId,
      }),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = () => [
  { title: appendToMetaTitle("Home") },
];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const handle = {
  breadcrumb: () => <Link to="/home">Home</Link>,
};

export default function HomePage() {
  const { skipOnboardingChecklist, checklistOptions } =
    useLoaderData<typeof loader>();
  const completedAllChecks = Object.values(checklistOptions).every(Boolean);

  return (
    <div>
      <Header> </Header>
      {completedAllChecks || skipOnboardingChecklist ? (
        <div className="pb-8">
          <AnnouncementBar />

          {/* KPI Summary Cards */}
          <div className="mt-4">
            <KpiCards />
          </div>

          {/* Row 1: Trends & Value — wide chart + value card */}
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <AssetGrowthChart />
            </div>
            <InventoryValueChart />
          </div>

          {/* Widget Grid — 3-column rows */}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Row 2: Bookings pipeline */}
            <UpcomingBookings />
            <ActiveBookings />
            <OverdueBookings />

            {/* Row 3: Reminders, Status & Locations */}
            <UpcomingReminders />
            <AssetsByStatusChart />
            <LocationDistribution />
          </div>

          {/* Row 4: People & Assets — 2-column */}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <CustodiansList />
            <NewestAssets />
          </div>
        </div>
      ) : (
        <OnboardingChecklist />
      )}
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
