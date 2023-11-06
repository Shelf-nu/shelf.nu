import { db } from "~/database";

export async function getAssetsCreatedInEachMonth({
  organizationId,
}: {
  organizationId: string;
}) {
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
      organizationId,
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

  const assetsCreated = months.map((month) => {
    const date = new Date(lastYear, months.indexOf(month), 1);
    const data = dailyData.find(
      (data) => new Date(data.createdAt).getMonth() === date.getMonth()
    );
    return {
      month,
      "Assets Created": data ? data._count.id : 0,
    };
  });
  return assetsCreated;
}
