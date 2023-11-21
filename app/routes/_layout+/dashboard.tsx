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
import { ErrorBoundryComponent } from "~/components/errors";
import { db } from "~/database";

import { requireAuthSession } from "~/modules/auth";
import { getOrganization } from "~/modules/organization";
import { requireOrganisationId } from "~/modules/organization/context.server";
import styles from "~/styles/layout/skeleton-loading.css";
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
import { parseMarkdownToReact } from "~/utils/md.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  /** This should be updated to use select to only get the data we need */
  const assets = await db.asset.findMany({
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
    },
  });

  const organization = await getOrganization({ id: organizationId });

  const announcement = await db.announcement.findFirst({
    where: {
      published: true,
    },
    orderBy: {
      createdAt: "desc",
    },
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

  return json({
    header: {
      title: "Dashboard",
    },
    assets,
    locale: getLocale(request),
    currency: organization?.currency,
    totalValuation,
    newAssets: assets.slice(0, 5),
    totalAssets: assets.length,
    skipOnboardingChecklist: cookie.skipOnboardingChecklist,

    custodiansData: await getCustodiansOrderedByTotalCustodies({
      assets,
    }),
    mostScannedAssets: await getMostScannedAssets({ assets }),
    mostScannedCategories: await getMostScannedAssetsCategories({ assets }),
    totalAssetsAtEndOfEachMonth: await totalAssetsAtEndOfEachMonth({
      assets,
    }),
    assetsByStatus: await groupAssetsByStatus({ assets }),
    assetsByCategory: await groupAssetsByCategory({ assets }),
    announcement: announcement
      ? {
          ...announcement,
          content: parseMarkdownToReact(announcement.content),
        }
      : null,
    checklistOptions: await checklistOptions({ assets, organizationId }),
  });
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
      {completedAllChecks || skipOnboardingChecklist ? (
        <div className="pb-8">
          <AnnouncementBar />
          <div className="w-full">
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

export const ErrorBoundary = () => <ErrorBoundryComponent />;
