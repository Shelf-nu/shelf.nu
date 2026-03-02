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
      assetAggregation,
      valueKnownAssets,
      // 1b. Assets by status
      statusGroups,
      // 1c. Monthly growth data
      monthlyRows,
      baselineCount,
      // 1d. Top custodians (direct custody)
      directCustodians,
      // 1d. Bookings for custodian merge (ongoing + overdue)
      { bookings: ongoingAndOverdueBookings },
      // Upcoming bookings
      { bookings: upcomingBookings },
      // Overdue bookings
      { bookings: overdueBookings },
      // Active/ongoing bookings
      { bookings: activeBookings },
      // 1e. Newest 5 assets
      newAssets,
      // Upcoming reminders
      upcomingReminders,
      // Announcement
      announcement,
      // KPI counts
      teamMembersCount,
      locationDistribution,
      locationsCount,
      categoriesCount,
      // Cookie
      cookieResult,
    ] = await Promise.all([
      // 1a. Asset count + total valuation
      db.asset
        .aggregate({
          where: { organizationId },
          _count: { _all: true },
          _sum: { valuation: true },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to load asset aggregation",
            additionalData: { userId, organizationId },
            label: "Dashboard",
          });
        }),

      // 1a. Count of assets with known valuation
      db.asset.count({
        where: { organizationId, valuation: { not: null } },
      }),

      // 1b. Assets grouped by status
      db.asset.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),

      // 1c. Monthly asset creation counts (last 12 months)
      db.$queryRaw<{ month_start: Date; assets_created: number }[]>`
        SELECT date_trunc('month', "createdAt") AS month_start,
               COUNT(*)::int AS assets_created
        FROM "Asset"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${twelveMonthsAgo}
        GROUP BY 1
        ORDER BY 1`,

      // 1c. Baseline count (assets before the 12-month window)
      db.asset.count({
        where: { organizationId, createdAt: { lt: twelveMonthsAgo } },
      }),

      // 1d. Team members with direct custody counts
      db.teamMember.findMany({
        where: { organizationId, custodies: { some: {} } },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
              email: true,
            },
          },
          _count: { select: { custodies: true } },
        },
        orderBy: { custodies: { _count: "desc" } },
        take: 20,
      }),

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
      db.asset
        .findMany({
          where: { organizationId },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { category: true },
        })
        .catch((cause) => {
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
      db.announcement
        .findFirst({
          where: { published: true },
          orderBy: { createdAt: "desc" },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to load announcement",
            additionalData: { userId, organizationId },
            label: "Dashboard",
          });
        }),

      // KPI: team members
      db.teamMember.count({
        where: { organizationId, deletedAt: null },
      }),

      // Location distribution (top 5)
      db.location
        .findMany({
          where: { organizationId },
          select: {
            id: true,
            name: true,
            _count: { select: { assets: true } },
          },
          orderBy: { assets: { _count: "desc" } },
          take: 5,
        })
        .then((locs) =>
          locs
            .filter((l) => l._count.assets > 0)
            .map((l) => ({
              locationId: l.id,
              locationName: l.name,
              assetCount: l._count.assets,
            }))
        ),

      // KPI: total locations
      db.location.count({
        where: { organizationId },
      }),

      // KPI: total categories
      db.category.count({
        where: { organizationId },
      }),

      // Cookie
      userPrefs.parse(request.headers.get("Cookie")).then((c: any) => c || {}),
    ]);

    const totalAssets = assetAggregation._count._all;
    const totalValuation = assetAggregation._sum.valuation ?? 0;

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
