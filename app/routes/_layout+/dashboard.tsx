import type {
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import AnnouncementBar from "~/components/dashboard/announcement-bar";
import AssetsByCategoryChart from "~/components/dashboard/assets-by-category-chart";
import AssetsByStatusChart from "~/components/dashboard/assets-by-status-chart";
import AssetsForEachMonth from "~/components/dashboard/assets-for-each-month";
import OnboardingChecklist from "~/components/dashboard/checklist";
import CustodiansList from "~/components/dashboard/custodians";
import InventoryValueChart from "~/components/dashboard/inventory-value-chart";
import LocationRatioChart from "~/components/dashboard/location-ratio-chart";
import MostScannedAssets from "~/components/dashboard/most-scanned-assets";
import MostScannedCategories from "~/components/dashboard/most-scanned-categories";
import NewestAssets from "~/components/dashboard/newest-assets";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import { db } from "~/database/db.server";
import { getBookings } from "~/modules/booking/service.server";

import styles from "~/styles/layout/skeleton-loading.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getLocale } from "~/utils/client-hints";
import { userPrefs } from "~/utils/cookies.server";
import {
  checklistOptions,
  getCustodiansOrderedByTotalCustodies,
  getMostScannedAssets,
  getMostScannedAssetsCategories,
  groupAssetsByCategory,
  groupAssetsByStatus,
  totalAssetsAtEndOfEachMonth,
} from "~/utils/dashboard.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
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

    /** This should be updated to use select to only get the data we need */
    const assets = await db.asset
      .findMany({
        where: {
          organizationId,
        },
        orderBy: {
          createdAt: "desc",
        },
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
          qrCodes: {
            include: {
              scans: true,
            },
          },
          kit: { select: { id: true, name: true, status: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load assets",
          additionalData: { userId, organizationId },
          label: "Dashboard",
        });
      });

    const { bookings } = await getBookings({
      organizationId,
      userId,
      page: 1,
      perPage: 1000,
      statuses: ["ONGOING", "OVERDUE"],
      extraInclude: {
        custodianTeamMember: true,
        custodianUser: true,
      },
    });

    const announcement = await db.announcement
      .findFirst({
        where: {
          published: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load announcement",
          additionalData: { userId, organizationId },
          label: "Dashboard",
        });
      });

    /** Calculate the total value of the assets that have value added */
    const totalValuation = assets.reduce((acc, asset) => {
      if (asset.valuation) {
        return acc + asset.valuation;
      }
      return acc;
    }, 0);
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};

    return json(
      data({
        assets,
        locale: getLocale(request),
        currency: currentOrganization?.currency,
        totalValuation,
        newAssets: assets.slice(0, 5),
        totalAssets: assets.length,
        skipOnboardingChecklist: cookie.skipOnboardingChecklist,
        custodiansData: getCustodiansOrderedByTotalCustodies({
          assets,
          bookings,
        }),
        mostScannedAssets: getMostScannedAssets({ assets }),
        mostScannedCategories: getMostScannedAssetsCategories({ assets }),
        totalAssetsAtEndOfEachMonth: totalAssetsAtEndOfEachMonth({
          assets,
        }),
        assetsByStatus: groupAssetsByStatus({ assets }),
        assetsByCategory: groupAssetsByCategory({ assets }),
        announcement: announcement
          ? {
              ...announcement,
              content: parseMarkdownToReact(announcement.content),
            }
          : null,
        checklistOptions: await checklistOptions({ assets, organizationId }),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = () => [
  { title: appendToMetaTitle("Dashboard") },
];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const handle = {
  breadcrumb: () => <Link to="/dashboard">Dashboard</Link>,
};

export default function DashboardPage() {
  const { skipOnboardingChecklist, checklistOptions } =
    useLoaderData<typeof loader>();
  const completedAllChecks = Object.values(checklistOptions).every(Boolean);

  return (
    <div>
      <Header />
      {completedAllChecks || skipOnboardingChecklist ? (
        <div className="pb-8">
          <AnnouncementBar />
          <div className="mt-4 w-full">
            <AssetsForEachMonth />
          </div>
          <div className="pb-4 xl:flex xl:gap-4">
            <div className="xl:lg-1/2 mb-4 w-full xl:mb-0">
              <InventoryValueChart />
            </div>
            <div className="xl:lg-1/2 w-full xl:mb-0">
              <LocationRatioChart />
            </div>
          </div>
          <div className="pb-4 xl:flex xl:gap-4">
            <div className="xl:lg-1/2 mb-4 w-full xl:mb-0">
              <AssetsByStatusChart />
            </div>
            <div className="xl:lg-1/2 w-full xl:mb-0">
              <AssetsByCategoryChart />
            </div>
          </div>
          <div className="pb-4 xl:flex xl:gap-4">
            <div className="mb-4 flex flex-col xl:mb-0 xl:w-1/2">
              <NewestAssets />
            </div>
            <div className="flex flex-col xl:mb-0 xl:w-1/2">
              <CustodiansList />
            </div>
          </div>
          <div className="pb-4 xl:flex xl:gap-4">
            <div className="mb-4 flex flex-col xl:mb-0 xl:w-1/2">
              <MostScannedAssets />
            </div>
            <div className="flex flex-col xl:mb-0 xl:w-1/2">
              <MostScannedCategories />
            </div>
          </div>
        </div>
      ) : (
        <OnboardingChecklist />
      )}
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
