import type { AssetStatus } from "@prisma/client";
import {
  assetStatusColorMap,
  userFriendlyAssetStatus,
} from "~/components/assets/asset-status-badge";
import { db } from "~/database/db.server";
import { defaultUserCategories } from "~/modules/user/service.server";
import { ShelfError } from "./error";

// ---------------------------------------------------------------------------
// buildAssetsByStatusChart — converts Prisma groupBy result to chart shape
// ---------------------------------------------------------------------------

export function buildAssetsByStatusChart(
  statusGroups: { status: string; _count: { _all: number } }[]
) {
  const chartData = statusGroups.map((g) => ({
    status: userFriendlyAssetStatus(g.status as AssetStatus),
    assets: g._count._all,
    color: assetStatusColorMap(g.status as AssetStatus).text,
  }));
  return { chartData };
}

// ---------------------------------------------------------------------------
// buildMonthlyGrowthData — builds cumulative chart data from raw SQL rows
// ---------------------------------------------------------------------------

interface MonthlyGrowthRow {
  month_start: Date;
  assets_created: number;
}

const MONTH_NAMES = [
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

export function buildMonthlyGrowthData(
  monthlyRows: MonthlyGrowthRow[],
  baselineCount: number
) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // Build a lookup: "YYYY-MM" → assetsCreated
  const rowMap = new Map<string, number>();
  for (const row of monthlyRows) {
    const d = new Date(row.month_start);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    rowMap.set(key, Number(row.assets_created));
  }

  // Build the 12-month array with cumulative totals
  let cumulative = baselineCount;
  const months: {
    month: string;
    year: number;
    assetsCreated: number;
    "Total assets": number;
  }[] = [];

  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const assetsCreated = rowMap.get(key) ?? 0;
    cumulative += assetsCreated;

    months.push({
      month: MONTH_NAMES[d.getMonth()],
      year: d.getFullYear(),
      assetsCreated,
      "Total assets": cumulative,
    });
  }

  return months;
}

// ---------------------------------------------------------------------------
// getCustodiansOrderedByTotalCustodies — pre-aggregated version
// ---------------------------------------------------------------------------

interface DirectCustodian {
  id: string;
  name: string;
  userId: string | null;
  user: {
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
    email: string;
  } | null;
  _count: { custodies: number };
}

interface BookingForCustodians {
  custodianUserId: string | null;
  custodianTeamMemberId: string | null;
  custodianTeamMember: {
    id: string;
    name: string;
    userId: string | null;
  } | null;
  custodianUser: {
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
    email: string;
  } | null;
  _count: { assets: number };
}

export function getCustodiansOrderedByTotalCustodies({
  directCustodians,
  bookings,
}: {
  directCustodians: DirectCustodian[];
  bookings: BookingForCustodians[];
}) {
  // Map keyed by (userId || teamMemberId)
  const countMap = new Map<
    string,
    {
      count: number;
      custodian: {
        id: string;
        name: string;
        userId: string | null;
        user: {
          firstName: string | null;
          lastName: string | null;
          profilePicture: string | null;
        } | null;
      };
    }
  >();

  // Add direct custodies
  for (const tm of directCustodians) {
    const key = tm.userId ?? tm.id;
    const existing = countMap.get(key);
    if (existing) {
      existing.count += tm._count.custodies;
    } else {
      countMap.set(key, {
        count: tm._count.custodies,
        custodian: {
          id: tm.id,
          name: tm.name,
          userId: tm.userId,
          user: tm.user
            ? {
                firstName: tm.user.firstName,
                lastName: tm.user.lastName,
                profilePicture: tm.user.profilePicture,
              }
            : null,
        },
      });
    }
  }

  // Add booking custodies
  for (const booking of bookings) {
    const assetCount = booking._count.assets;
    if (assetCount === 0) continue;

    if (booking.custodianTeamMemberId && booking.custodianTeamMember) {
      const key =
        booking.custodianTeamMember.userId ?? booking.custodianTeamMemberId;
      const existing = countMap.get(key);
      if (existing) {
        existing.count += assetCount;
      } else {
        countMap.set(key, {
          count: assetCount,
          custodian: {
            id: booking.custodianTeamMemberId,
            name: booking.custodianTeamMember.name,
            userId: booking.custodianTeamMember.userId,
            user: null,
          },
        });
      }
    } else if (booking.custodianUserId && booking.custodianUser) {
      const key = booking.custodianUserId;
      const existing = countMap.get(key);
      if (existing) {
        existing.count += assetCount;
      } else {
        countMap.set(key, {
          count: assetCount,
          custodian: {
            id: booking.custodianUserId,
            name: "",
            userId: booking.custodianUserId,
            user: {
              firstName: booking.custodianUser.firstName,
              lastName: booking.custodianUser.lastName,
              profilePicture: booking.custodianUser.profilePicture,
            },
          },
        });
      }
    }
  }

  // Sort by count desc, then by id for stable order
  const sorted = [...countMap.entries()]
    .sort(
      ([aKey, a], [bKey, b]) => b.count - a.count || aKey.localeCompare(bKey)
    )
    .slice(0, 5);

  return sorted.map(([id, { count, custodian }]) => ({
    id,
    count,
    custodian,
  }));
}

// ---------------------------------------------------------------------------
// checklistOptions
// ---------------------------------------------------------------------------

export async function checklistOptions({
  hasAssets,
  organizationId,
}: {
  hasAssets: boolean;
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
      db.category.count({
        where: {
          organizationId,
          name: {
            notIn: defaultUserCategories.map((uc) => uc.name),
          },
        },
      }),

      db.tag.count({
        where: { organizationId },
      }),

      db.teamMember.count({
        where: { organizationId },
      }),

      db.teamMember.count({
        where: {
          organizationId,
          custodies: { some: {} },
        },
      }),

      db.customField.count({
        where: {
          organizationId,
          deletedAt: null,
        },
      }),
    ]);

    return {
      hasAssets,
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
