import type { Custody, Prisma } from "@prisma/client";
import {
  assetStatusColorMap,
  userFriendlyAssetStatus,
} from "~/components/assets/asset-status-badge";
import { db } from "~/database/db.server";
import type { TeamMemberWithUser } from "~/modules/team-member/types";
import { defaultUserCategories } from "~/modules/user/service.server";
import { ShelfError } from "./error";

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
export function totalAssetsAtEndOfEachMonth({ assets }: { assets: Asset[] }) {
  const currentDate = new Date();
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);

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

  const monthsArray = [];

  // Add the current month to the array
  const currentMonthName = months[currentDate.getMonth()];
  const currentYear = currentDate.getFullYear();

  // Add the previous 12 months to the array
  for (let i = 0; i < 12; i++) {
    const monthDate = new Date();
    monthDate.setFullYear(
      twelveMonthsAgo.getFullYear(),
      twelveMonthsAgo.getMonth() + i,
      1
    );
    const monthName = months[monthDate.getMonth()];
    const year = monthDate.getFullYear();

    // Prevent adding the current month in this loop
    if (monthName === currentMonthName && year === currentYear) {
      continue;
    }

    monthsArray.push({
      month: monthName,
      year,
      assetsCreated: 0,
      "Total assets": 0,
    });
  }

  // Add the current month to the array
  monthsArray.push({
    month: currentMonthName,
    year: currentYear,
    assetsCreated: 0,
    "Total assets": 0,
  });
  // Sort the array by year and month
  monthsArray.sort((a, b) => {
    const yearA = a.year;
    const yearB = b.year;
    const monthA = months.indexOf(a.month);
    const monthB = months.indexOf(b.month);
    return yearA - yearB || monthA - monthB;
  });

  // Get the total of assets created in each month
  let totalAssets = 0;
  for (let asset of assets) {
    const assetCreatedDate = new Date(asset.createdAt);
    const assetCreatedMonth = assetCreatedDate.getMonth();
    const assetCreatedYear = assetCreatedDate.getFullYear();

    // If the asset was created in the last year
    if (
      assetCreatedDate >= twelveMonthsAgo &&
      assetCreatedDate <= currentDate
    ) {
      // Find the month object in the months array that matches the asset creation date
      const month = monthsArray.find(
        (m) =>
          m.month === months[assetCreatedMonth] && m.year === assetCreatedYear
      );
      if (month) {
        month.assetsCreated += 1;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      totalAssets += 1;
    }
  }

  // Calculate the total number of assets that existed at the end of each month
  let assetsExisting = 0;
  for (let i = 0; i < monthsArray.length; i++) {
    const currentMonth = monthsArray[i];
    const previousMonth = monthsArray[i - 1];

    // If the current month is not the first month and it's the same as the previous month, skip it
    if (
      previousMonth &&
      currentMonth.month === previousMonth.month &&
      currentMonth.year === previousMonth.year + 1
    ) {
      continue;
    }

    assetsExisting += currentMonth.assetsCreated;
    currentMonth["Total assets"] = assetsExisting;
  }

  //Return the array of months with the total number of assets that existed at the end of each month
  return monthsArray;
}

/**
 * Custodians ordered by total custodies
 */
function hasCustody(asset: Asset): asset is Asset & { custody: Custody } {
  return asset.custody !== null;
}

export function getCustodiansOrderedByTotalCustodies({
  assets,
  bookings,
}: {
  assets: Asset[];
  bookings: Prisma.BookingGetPayload<{
    include: {
      custodianTeamMember: true;
      custodianUser: true;
      assets: true;
    };
  }>[];
}) {
  const assetsWithCustody = assets.filter(
    (asset) => asset.custody && asset.custody.custodian
  );

  /** All custodians with directly assigned custody via assets */
  const allDirectCustodians = Array.from(
    new Set(
      assetsWithCustody
        .filter(hasCustody)
        .map((asset) => asset.custody.custodian)
    )
  ).filter(Boolean);

  /** All custodians with custody via bookings */
  const allBookerCustodians = Array.from(
    new Set(
      bookings.map((booking) =>
        booking.custodianUser
          ? {
              id: booking.custodianUserId,
              userId: booking.custodianUserId,
              user: booking.custodianUser,
            }
          : {
              id: booking.custodianTeamMemberId,
              ...booking.custodianTeamMember,
            }
      )
    )
  ).filter(Boolean);

  const allCustodians = [...allDirectCustodians, ...allBookerCustodians];
  let custodianCounts: { [key: string]: number } = {};

  /** Count normal custodies */
  for (let asset of assetsWithCustody) {
    if (asset.custody) {
      // will use userId to map and show consolidated hold of assets (through bookings or direct custodies) of a team member, in case of NRM will use custodian id
      let userId = asset.custody.custodian.userId
        ? asset.custody.custodian.userId
        : asset.custody.custodian.id;
      custodianCounts[userId] = (custodianCounts[userId] || 0) + 1;
    }
  }

  /** Count custodies via bookings */
  for (let booking of bookings) {
    if (booking.custodianUserId) {
      custodianCounts[booking.custodianUserId] =
        (custodianCounts[booking.custodianUserId] || 0) + booking.assets.length;
    } else if (booking.custodianTeamMemberId) {
      custodianCounts[booking.custodianTeamMemberId] =
        (custodianCounts[booking.custodianTeamMemberId] || 0) +
        booking.assets.length;
    }
  }

  /**
   * Make array for easier sorting
   */
  const custodianCountsArray = Object.entries(custodianCounts).map(
    ([id, count]) => ({
      id,
      count,
      custodian: allCustodians.find((custodian) =>
        custodian.userId ? custodian.userId === id : custodian.id === id
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
export function getMostScannedAssets<T extends Asset>({
  assets,
}: {
  assets: T[];
}) {
  const assetsWithScans = assets.filter((asset) => asset.qrCodes.length > 0);

  const assetsWithScanCount = assetsWithScans.map((asset) => ({
    ...asset,
    scanCount: asset.qrCodes.reduce(
      (count, qrCode) => count + qrCode.scans.length,
      0
    ),
  }));

  assetsWithScanCount.sort((a, b) => b.scanCount - a.scanCount);

  const top5Assets = assetsWithScanCount.slice(0, 5);

  return top5Assets;
}

/**
 * Most scanned assets' categories
 * Gives a list of the categories from all assets
 */
export function getMostScannedAssetsCategories({
  assets,
}: {
  assets: Asset[];
}) {
  const assetsWithScans = assets.filter((asset) => asset.qrCodes.length > 0);

  const assetsWithScanCount = assetsWithScans.map((asset) => ({
    ...asset,
    scanCount: asset.qrCodes.reduce(
      (count, qrCode) => count + qrCode.scans.length,
      0
    ),
  }));

  // group the assets by their category. assets without category should be grouped as "Ucatagorized"
  const assetsByCategory: {
    [key: string]: {
      category: string;
      assets: Asset[];
      scanCount: number;
    };
  } = {};

  for (let asset of assetsWithScanCount) {
    let category = asset.category?.name || "Uncategorized";
    if (!assetsByCategory[category]) {
      assetsByCategory[category] = {
        category,
        assets: [],
        scanCount: 0,
      };
    }
    assetsByCategory[category].assets.push(asset);
    assetsByCategory[category].scanCount += asset.scanCount;
  }

  const assetsByCategoryArray = Object.values(assetsByCategory);

  // Calculate the total count of scans for each category
  assetsByCategoryArray.sort((a, b) => b.scanCount - a.scanCount);

  // Get the top 5 categories
  const top5Categories = assetsByCategoryArray.slice(0, 5);

  return top5Categories.map((cd) => ({
    name: cd.category,
    scanCount: cd.scanCount,
    assetCount: cd.assets.length,
  }));
}

/**
 * Assets grouped per status
 */
export function groupAssetsByStatus({ assets }: { assets: Asset[] }) {
  const assetsByStatus: Record<
    string,
    { status: string; assets: Asset[]; color: string }
  > = {};

  for (let asset of assets) {
    let status = asset.status;
    if (!assetsByStatus[status]) {
      assetsByStatus[status] = {
        status: userFriendlyAssetStatus(status),
        assets: [],
        color: assetStatusColorMap(status),
      };
    }
    assetsByStatus[status].assets.push(asset);
  }

  const assetsByStatusArray = Object.values(assetsByStatus);

  const chartData = assetsByStatusArray.map((cd) => ({
    status: cd.status,
    assets: cd.assets.length,
    color: cd.color,
  }));

  return {
    chartData,
  };
}

/**
 * Assets grouped per category
 */
export function groupAssetsByCategory({ assets }: { assets: Asset[] }) {
  const assetsByCategory: Record<
    string,
    { category: string; assets: Asset[]; id: string }
  > = {};

  for (let asset of assets) {
    let category = asset.category?.name || "Uncategorized";
    let id = asset?.category?.id || "Uncategorized";
    if (!assetsByCategory[category]) {
      assetsByCategory[category] = {
        category,
        id,
        assets: [],
      };
    }
    assetsByCategory[category].assets.push(asset);
  }

  const assetsByCategoryArray = Object.values(assetsByCategory);

  const chartData = assetsByCategoryArray.map((cd) => ({
    category: cd.category,
    id: cd.id,
    assets: cd.assets.length,
  }));

  // Order chart data based on item count
  chartData.sort((a, b) => b.assets - a.assets);

  // Get the top 6 categories
  const top6Categories = chartData.slice(0, 6);

  return top6Categories;
}

export async function checklistOptions({
  assets,
  organizationId,
}: {
  assets: Asset[];
  organizationId: string;
}) {
  try {
    const [
      categoriesCount,
      tagsCount,
      teamMembersCount,
      custodiesCount,
      customFieldsCount,
    ] = await Promise.all([
      /** Get the categories */
      db.category.count({
        where: {
          organizationId,
          name: {
            notIn: defaultUserCategories.map((uc) => uc.name),
          },
        },
      }),

      db.tag.count({
        where: {
          organizationId,
        },
      }),

      db.teamMember.count({
        where: {
          organizationId,
        },
      }),

      db.teamMember.count({
        where: {
          organizationId,
          custodies: {
            some: {},
          },
        },
      }),
      db.customField.count({
        where: {
          organizationId,
        },
      }),
    ]);

    return {
      hasAssets: assets.length > 0,
      hasCategories: categoriesCount > 0,
      hasTags: tagsCount > 0,
      hasTeamMembers: teamMembersCount > 0,
      hasCustodies: custodiesCount > 0,
      hasCustomFields: customFieldsCount > 0,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while loading checklist options. Please try again or contact support.",
      additionalData: { organizationId },
      label: "Dashboard",
    });
  }
}
