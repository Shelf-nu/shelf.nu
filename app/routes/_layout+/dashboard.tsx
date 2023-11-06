import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import AssetsAreaChart from "~/components/dashboard/assets-area-chart";
import CustodiansList from "~/components/dashboard/custodians";
import NewestAssets from "~/components/dashboard/newest-assets";
import NewsBar from "~/components/dashboard/news-bar";
import { ErrorBoundryComponent } from "~/components/errors";
import { db } from "~/database";
import { getAssets } from "~/modules/asset";

import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { getAssetsCreatedInEachMonth } from "~/utils/get-assets-created-in-each-month";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const page = 1;
  const perPage = 5;
  const newAssets = await getAssets({ organizationId, page, perPage });

  /**
   * @TODO
   * Here I think we might have to change this and need a second query. Because we cannot use select using groupBy
   * and we actually need the custodian name and if there is a user attached to it we also need to know that user's first and last name as well as profile picture
   *
   * So we might need to make a new query using the Ids and merge the data together
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
    organizationId,
  });

  return json({
    newAssets,
    custodians,
    totalAssets: await db.asset.count({
      where: {
        organizationId,
      },
    }),
    assetsCreatedInEachMonth,
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
