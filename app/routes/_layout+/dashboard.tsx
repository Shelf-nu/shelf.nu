import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import AssetsAreaChart from "~/components/dashboard/assets-area-chart";
import AssetsByStatusChart from "~/components/dashboard/assets-by-status-chart";
import CustodiansList from "~/components/dashboard/custodians";
import NewestAssets from "~/components/dashboard/newest-assets";
import NewsBar from "~/components/dashboard/news-bar";
import { ErrorBoundryComponent } from "~/components/errors";
import { db } from "~/database";

import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { getAssetsCreatedInEachMonth } from "~/utils/get-assets-created-in-each-month";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
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
          custodian: true,
        },
      },
    },
  });

  /**
   * @TODO
   * We need to drop this. So the idea is that we just have 1 query that gives us all the data(see above) and then we create the different data sets from that.
   */
  const custodians = await db.custody.groupBy({
    by: ["teamMemberId", "id"],
    _count: {
      teamMemberId: true,
    },
    orderBy: {
      _count: {
        teamMemberId: "desc",
      },
    },
  });
  const assetsCreatedInEachMonth = await getAssetsCreatedInEachMonth({
    assets,
  });

  const assetsByStatus = await db.asset.groupBy({
    by: ["status"],
    _count: {
      status: true,
    },
    where: {
      status: {
        in: ["AVAILABLE", "IN_CUSTODY"],
      },
    },
  });

  return json({
    newAssets: assets.slice(0, 5),
    custodians,
    totalAssets: assets.length,
    assetsCreatedInEachMonth,
    assetsByStatus,
  });
}

export const handle = {
  breadcrumb: () => <Link to="/dashboard">Dashboard</Link>,
};

export default function DashboardPage() {
  return (
    <div>
      <NewsBar
        heading="We’ve just announced our Series A!"
        description="Read about it from our CEO."
        url="."
      />
      <div className="w-full">
        <AssetsAreaChart />
      </div>
      <div className="flex gap-4">
        <AssetsByStatusChart />
        <AssetsByStatusChart />
      </div>
      <div className="flex gap-4">
        <div className="lg:w-1/2">
          <NewestAssets />
        </div>
        <div className="lg:w-1/2">
          <CustodiansList />
        </div>
      </div>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
