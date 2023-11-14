import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import AnnouncementBar from "~/components/dashboard/announcement-bar";
import AssetsByCategoryChart from "~/components/dashboard/assets-by-category-chart";
import AssetsByStatusChart from "~/components/dashboard/assets-by-status-chart";
import AssetsForEachMonth from "~/components/dashboard/assets-for-each-month";
import CustodiansList from "~/components/dashboard/custodians";
import MostScannedAssets from "~/components/dashboard/most-scanned-assets";
import MostScannedCategories from "~/components/dashboard/most-scanned-categories";
import NewestAssets from "~/components/dashboard/newest-assets";
import { ErrorBoundryComponent } from "~/components/errors";
import { db } from "~/database";

import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
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

  const announcement = await db.announcement.findFirst({
    where: {
      published: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return json({
    header: {
      title: "Dashboard",
    },
    newAssets: assets.slice(0, 5),
    totalAssets: assets.length,

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
  });
}

export const meta: MetaFunction<typeof loader> = () => [
  { title: appendToMetaTitle("Dashboard") },
];

export const handle = {
  breadcrumb: () => <Link to="/dashboard">Dashboard</Link>,
};

export default function DashboardPage() {
  return (
    <div>
      <AnnouncementBar />
      <div className="w-full">
        <AssetsForEachMonth />
      </div>
      <div className="xl:flex xl:gap-4">
        <div className="xl:lg-1/2 w-full">
          <AssetsByStatusChart />
        </div>
        <div className="xl:lg-1/2 w-full">
          <AssetsByCategoryChart />
        </div>
      </div>
      <div className="mb-4 xl:flex xl:gap-4">
        <div className="mb-4 xl:mb-0 xl:w-1/2">
          <NewestAssets />
        </div>
        <div className="xl:w-1/2">
          <CustodiansList />
        </div>
      </div>
      <div className="xl:flex xl:gap-4">
        <div className="mb-4 xl:mb-0 xl:w-1/2">
          <MostScannedAssets />
        </div>
        <div className="xl:w-1/2">
          <MostScannedCategories />
        </div>
      </div>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
