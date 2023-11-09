import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import AssetsAreaChart from "~/components/dashboard/assets-area-chart";
import CustodiansList from "~/components/dashboard/custodians";
import NewestAssets from "~/components/dashboard/newest-assets";
import NewsBar from "~/components/dashboard/news-bar";
import { ErrorBoundryComponent } from "~/components/errors";
import { db } from "~/database";

import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import {
  getAssetsCreatedInEachMonth,
  getCustodiansOrderedByTotalCustodies,
} from "~/utils/dashboard.server";

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

  const assetsCreatedInEachMonth = await getAssetsCreatedInEachMonth({
    assets,
  });

  const custodiansData = await getCustodiansOrderedByTotalCustodies({
    assets,
  });

  return json({
    newAssets: assets.slice(0, 5),
    custodiansData,
    totalAssets: assets.length,
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
