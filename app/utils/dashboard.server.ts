// import type { Asset } from "@prisma/client";

import type { Custody, Prisma } from "@prisma/client";
import type { TeamMemberWithUser } from "~/modules/team-member/types";

type Asset = Prisma.AssetGetPayload<{
  include: {
    category: true;
    custody: {
      include: {
        custodian: true;
      };
    };
    qrCodes: {
      include: {
        scans: true;
      };
    };
  };
}>;

/**
 * Asset created in each month in the last year.
 * */

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

/**
 * Custodians ordered by total custodies
 */

function hasCustody(asset: Asset): asset is Asset & { custody: Custody } {
  return asset.custody !== null;
}

export async function getCustodiansOrderedByTotalCustodies({
  assets,
}: {
  assets: Asset[];
}) {
  const assetsWithCustody = assets.filter(
    (asset) => asset.custody && asset.custody.custodian
  );
  const allCustodiansSet = new Set(
    assetsWithCustody.filter(hasCustody).map((asset) => asset.custody.custodian)
  );
  const allCustodians = Array.from(allCustodiansSet).filter(Boolean);

  let custodianCounts: { [key: string]: number } = {};

  for (let asset of assetsWithCustody) {
    if (asset.custody) {
      let custodianId = asset.custody.custodian.id;
      custodianCounts[custodianId] = (custodianCounts[custodianId] || 0) + 1;
    }
  }

  /**
   * Make array for easier sorting
   */
  const custodianCountsArray = Object.entries(custodianCounts).map(
    ([id, count]) => ({
      id,
      count,
      custodian: allCustodians.find(
        (custodian) => custodian.id === id
      ) as TeamMemberWithUser,
    })
  );

  /** Sort the array based on the amount of assets per custodian */
  custodianCountsArray.sort(
    (a, b) => b.count - a.count || a.id.localeCompare(b.id)
  );
  /** Get the top 5 custodians */
  const top5Custodians = custodianCountsArray.slice(0, 5);

  return top5Custodians;
}

/**
 * Most scanned assets
 */

/**
 * Most scanned categories
 */
