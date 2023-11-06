import type { Asset } from "@prisma/client";

export async function getAssetsCreatedInEachMonth({
  assets,
}: {
  assets: Asset[];
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

  const assetsCreated = months.map((month, index) => {
    const date = new Date(lastYear, index, 1);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    date.setMilliseconds(date.getMilliseconds() - 1);
    const assetsCreatedBeforeMonth = assets.reduce((count, asset) => {
      const assetDate = new Date(asset.createdAt);
      if (assetDate.getTime() <= date.getTime()) {
        return count + 1;
      }
      return count;
    }, 0);
    return {
      month,
      "Assets Created": assetsCreatedBeforeMonth,
    };
  });
  return assetsCreated;
}
