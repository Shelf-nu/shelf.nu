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
  checklistOptions,
  getCustodiansOrderedByTotalCustodies,
  groupAssetsByStatus,
  totalAssetsAtEndOfEachMonth,
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

    // Fetch all data in parallel for performance
    const [
      assets,
      { bookings: ongoingAndOverdueBookings },
      { bookings: upcomingBookings },
      { bookings: overdueBookings },
      { bookings: activeBookings },
      upcomingReminders,
      announcement,
      teamMembersCount,
      locationDistribution,
      locationsCount,
      categoriesCount,
      cookieResult,
    ] = await Promise.all([
      // All assets for server-side analytics (no qrCodes — unused since Most Scanned removal)
      db.asset
        .findMany({
          where: { organizationId },
          orderBy: { createdAt: "desc" },
          include: {
            category: true,
            custody: {
              include: {
                custodian: {
                  include: {
                    user: {
                      select: {
                        firstName: true,
                        lastName: true,
                        profilePicture: true,
                        email: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to load assets",
            additionalData: { userId, organizationId },
            label: "Dashboard",
          });
        }),

      // Existing: ongoing + overdue for custodians list
      getBookings({
        organizationId,
        userId,
        page: 1,
        perPage: 1000,
        statuses: ["ONGOING", "OVERDUE"],
        extraInclude: {
          custodianTeamMember: true,
          custodianUser: true,
        },
      }),

      // NEW: upcoming bookings (RESERVED, future)
      getBookings({
        organizationId,
        userId,
        page: 1,
        perPage: 5,
        statuses: ["RESERVED"],
        bookingFrom: new Date(),
        extraInclude: {
          custodianTeamMember: true,
          custodianUser: true,
          _count: { select: { assets: true } },
        },
      }),

      // NEW: overdue bookings
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

      // NEW: active/ongoing bookings
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

      // NEW: upcoming reminders
      getUpcomingRemindersForHomePage({ organizationId }),

      // Existing: announcement
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

      // NEW: KPI - team members
      db.teamMember.count({
        where: { organizationId, deletedAt: null },
      }),

      // NEW: location distribution (top 5) — single query with location names
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

    /** Calculate the total value and count of assets that have value added */
    let totalValuation = 0;
    let valueKnownAssets = 0;
    for (const asset of assets) {
      if (asset.valuation) {
        totalValuation += asset.valuation;
        valueKnownAssets++;
      }
    }

    const header: HeaderData = {
      title: "Home",
    };

    return payload({
      header,
      // KPI data
      totalAssets: assets.length,
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
      newAssets: assets.slice(0, 5),
      skipOnboardingChecklist: cookieResult.skipOnboardingChecklist,
      custodiansData: getCustodiansOrderedByTotalCustodies({
        assets,
        bookings: ongoingAndOverdueBookings,
      }),
      assetsByStatus: groupAssetsByStatus({ assets }),
      assetGrowthData: totalAssetsAtEndOfEachMonth({ assets }),
      announcement: announcement
        ? {
            ...announcement,
            content: parseMarkdownToReact(announcement.content),
          }
        : null,
      checklistOptions: await checklistOptions({ assets, organizationId }),
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
