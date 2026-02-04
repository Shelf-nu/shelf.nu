import { AssetStatus, BookingStatus, type Prisma } from "@prisma/client";
import { addMinutes, isAfter, isBefore, subMinutes } from "date-fns";
import { ONE_DAY, ONE_HOUR } from "~/utils/constants";

/**
 * Generates dynamic Prisma orderBy clause for booking assets
 * @param orderBy - The field to sort by (status, title, category, kit)
 * @param orderDirection - The sort direction (asc or desc)
 * @returns Array of Prisma orderBy inputs
 */
export function getBookingAssetsOrderBy(
  orderBy: string = "status",
  orderDirection: "asc" | "desc" = "desc"
): Prisma.AssetOrderByWithRelationInput[] {
  const orderByMap: Record<string, Prisma.AssetOrderByWithRelationInput[]> = {
    status: [{ status: orderDirection }, { createdAt: "asc" }],
    title: [{ title: orderDirection }],
    category: [{ category: { name: orderDirection } }],
  };
  return orderByMap[orderBy] || orderByMap.status;
}

type AssetWithKit = {
  id: string;
  title: string;
  status: string;
  kitId: string | null;
  kit: { name: string } | null;
  category: { name: string } | null;
  [key: string]: unknown;
};

/**
 * Groups assets by kit and sorts both kits and assets within them.
 * Returns: sorted kit assets (grouped) followed by sorted individual assets.
 *
 * @param assets - Array of assets with kit information
 * @param orderBy - Field to sort by (status, title, category, kit)
 * @param orderDirection - Sort direction (asc or desc)
 * @returns Sorted array with kit assets grouped together
 */
export function groupAndSortAssetsByKit<T extends AssetWithKit>(
  assets: T[],
  orderBy: string = "status",
  orderDirection: "asc" | "desc" = "desc"
): T[] {
  // Separate kit assets from individual assets
  const kitAssets: T[] = [];
  const individualAssets: T[] = [];

  for (const asset of assets) {
    if (asset.kitId && asset.kit) {
      kitAssets.push(asset);
    } else {
      individualAssets.push(asset);
    }
  }

  // Group kit assets by kitId
  const kitGroups = new Map<string, { kitName: string; assets: T[] }>();
  for (const asset of kitAssets) {
    const kitId = asset.kitId!;
    if (!kitGroups.has(kitId)) {
      kitGroups.set(kitId, { kitName: asset.kit!.name, assets: [] });
    }
    kitGroups.get(kitId)!.assets.push(asset);
  }

  // Sort function based on orderBy
  const compareAssets = (a: T, b: T): number => {
    const multiplier = orderDirection === "asc" ? 1 : -1;

    switch (orderBy) {
      case "title":
        return multiplier * a.title.localeCompare(b.title);
      case "category": {
        const catA = a.category?.name;
        const catB = b.category?.name;
        // Null categories go to the end regardless of direction
        if (!catA && catB) return 1;
        if (catA && !catB) return -1;
        if (!catA && !catB) return a.title.localeCompare(b.title);
        // At this point both catA and catB are defined (handled above)
        return multiplier * catA!.localeCompare(catB!);
      }
      case "status":
      default: {
        // For status, CHECKED_OUT should come before AVAILABLE when desc
        // Priority: CHECKED_OUT=1 (urgent), AVAILABLE=3 (least urgent)
        const statusOrder: Record<string, number> = {
          CHECKED_OUT: 1,
          IN_CUSTODY: 2,
          AVAILABLE: 3,
        };
        const statusA = statusOrder[a.status] || 99;
        const statusB = statusOrder[b.status] || 99;
        // For "desc", lower priority number comes first (CHECKED_OUT before AVAILABLE)
        // For "asc", higher priority number comes first (AVAILABLE before CHECKED_OUT)
        const statusMultiplier = orderDirection === "desc" ? 1 : -1;
        const statusDiff = statusMultiplier * (statusA - statusB);
        // Secondary sort by title for consistency
        return statusDiff !== 0 ? statusDiff : a.title.localeCompare(b.title);
      }
    }
  };

  // First, sort assets within each kit group
  for (const [, group] of kitGroups) {
    group.assets.sort(compareAssets);
  }

  // Sort individual assets
  individualAssets.sort(compareAssets);

  // Now sort kit groups by the sort criteria
  // (after sorting assets within, so we can use the first sorted asset for comparison)
  const sortedKitGroups = Array.from(kitGroups.entries()).sort(
    ([, groupA], [, groupB]) => {
      const multiplier = orderDirection === "asc" ? 1 : -1;

      switch (orderBy) {
        case "title":
          // Sort kits by kit name when sorting by name
          return multiplier * groupA.kitName.localeCompare(groupB.kitName);
        case "category": {
          // Sort kits by first asset's category (after assets are sorted)
          const catA = groupA.assets[0]?.category?.name;
          const catB = groupB.assets[0]?.category?.name;
          // Null categories go to the end regardless of direction
          if (!catA && catB) return 1;
          if (catA && !catB) return -1;
          if (!catA && !catB)
            return groupA.kitName.localeCompare(groupB.kitName);
          // At this point both catA and catB are defined (handled above)
          return multiplier * catA!.localeCompare(catB!);
        }
        case "status":
        default: {
          // Sort kits by "most urgent" status in the kit
          const getKitPriority = (assets: T[]) => {
            const statusOrder: Record<string, number> = {
              CHECKED_OUT: 1,
              IN_CUSTODY: 2,
              AVAILABLE: 3,
            };
            if (assets.length === 0) return 99;
            return Math.min(...assets.map((a) => statusOrder[a.status] || 99));
          };
          const priorityA = getKitPriority(groupA.assets);
          const priorityB = getKitPriority(groupB.assets);
          // For "desc", lower priority number comes first (CHECKED_OUT before AVAILABLE)
          // For "asc", higher priority number comes first (AVAILABLE before CHECKED_OUT)
          const statusMultiplier = orderDirection === "desc" ? 1 : -1;
          const priorityDiff = statusMultiplier * (priorityA - priorityB);
          return priorityDiff !== 0
            ? priorityDiff
            : groupA.kitName.localeCompare(groupB.kitName);
        }
      }
    }
  );

  // Flatten: all kit assets (grouped) + individual assets
  const result: T[] = [];
  for (const [, group] of sortedKitGroups) {
    result.push(...group.assets);
  }
  result.push(...individualAssets);

  return result;
}

/**
 * This function checks if the booking is being early checkout.
 * It only considers it early if it's more than 15 minutes before the booking start time.
 */
export function isBookingEarlyCheckout(from: Date): boolean {
  const now = new Date();
  const fromWithBuffer = subMinutes(from, 15);
  return isAfter(fromWithBuffer, now);
}

/**
 * This function checks if the booking is being early checkin.
 * It only considers it early if it's more than 15 minutes before the booking end time.
 */
export function isBookingEarlyCheckin(to: Date) {
  const nowWithBuffer = addMinutes(new Date(), 15);
  return isBefore(nowWithBuffer, to);
}

// Calculate and format booking duration
export function formatBookingDuration(from: Date, to: Date): string {
  const start = new Date(from);
  const end = new Date(to);

  // Calculate duration in milliseconds
  const durationMs = end.getTime() - start.getTime();

  // Convert to days, hours, minutes
  const days = Math.floor(durationMs / ONE_DAY);
  const hours = Math.floor((durationMs % ONE_DAY) / ONE_HOUR);
  const minutes = Math.floor((durationMs % ONE_HOUR) / (1000 * 60));

  // Format the duration string
  let durationStr = "";

  if (days > 0) {
    durationStr += `${days} day${days !== 1 ? "s" : ""}`;
  }

  if (hours > 0) {
    durationStr += durationStr ? " · " : "";
    durationStr += `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  if (minutes > 0 || (days === 0 && hours === 0)) {
    durationStr += durationStr ? " · " : "";
    durationStr += `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  return durationStr;
}

/**
 * Core logic for determining if an asset has booking conflicts
 * Used by both isAssetAlreadyBooked and kit-related functions
 */
export function hasAssetBookingConflicts(
  asset: {
    status: string;
    bookings?: { id: string; status: string }[];
  },
  currentBookingId: string
): boolean {
  if (!asset.bookings?.length) return false;

  const conflictingBookings = asset.bookings.filter(
    (b) => b.id !== currentBookingId
  );

  if (conflictingBookings.length === 0) return false;

  // Check if any conflicting booking is RESERVED (always conflicts)
  const hasReservedConflict = conflictingBookings.some(
    (b) => b.status === BookingStatus.RESERVED
  );

  if (hasReservedConflict) return true;

  // For ONGOING/OVERDUE bookings, only conflict if asset is actually CHECKED_OUT
  const hasOngoingConflict = conflictingBookings.some(
    (b) =>
      (b.status === BookingStatus.ONGOING ||
        b.status === BookingStatus.OVERDUE) &&
      asset.status === AssetStatus.CHECKED_OUT
  );

  return hasOngoingConflict;
}

/**
 * Determines if an asset is already booked and unavailable for the current booking context
 * Handles partial check-in logic properly
 */
export function isAssetAlreadyBooked(
  asset: {
    status: string;
    bookings?: { id: string; status: string }[];
  },
  currentBookingId: string
): boolean {
  return hasAssetBookingConflicts(asset, currentBookingId);
}
