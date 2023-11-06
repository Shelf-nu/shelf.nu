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

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  const { userId } = await requireAuthSession(request);
  const page = 1;
  const perPage = 5;
  const newAssets = await getAssets({ userId, page, perPage });

  const custodians = await db.custody.groupBy({
    by: ["teamMemberId"],
    _count: {
      teamMemberId: true,
    },
    orderBy: {
      _count: {
        teamMemberId: "desc",
      },
    },
  });
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(lastYear);

  const dailyData = await db.asset.groupBy({
    by: ["createdAt"],
    where: {
      createdAt: {
        gte: oneYearAgo,
      },
    },
    _count: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const chartData = months.map((month) => {
    const date = new Date(lastYear, months.indexOf(month), 1);
    const data = dailyData.find(
      (data) => new Date(data.createdAt).getMonth() === date.getMonth()
    );
    return {
      month,
      "Assets Created": data ? data._count.id : 0,
    };
  });
  return json({
    newAssets,
    custodians,
    chartData,
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
