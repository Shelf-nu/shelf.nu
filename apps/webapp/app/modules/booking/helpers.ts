import { AssetStatus, BookingStatus } from "@prisma/client";
import { addMinutes, isAfter, isBefore, subMinutes } from "date-fns";
import { ONE_DAY, ONE_HOUR } from "~/utils/constants";

type AssetWithKit = {
  id: string;
  title: string;
  status: string;
  kitId: string | null;
  kit: { name: string; location?: { name: string } | null } | null;
  category: { name: string } | null;
  location?: { name: string } | null;
  [key: string]: unknown;
};

/**
 * Groups assets by kit and sorts both kits and assets within them.
 * Returns: sorted kit assets (grouped) followed by sorted individual assets.
 *
 * @param assets - Array of assets with kit information
 * @param orderBy - Field to sort by (status, title, category, location)
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
  const kitGroups = new Map<
    string,
    { kitName: string; kitLocationName: string | null; assets: T[] }
  >();
  for (const asset of kitAssets) {
    const kitId = asset.kitId!;
    if (!kitGroups.has(kitId)) {
      kitGroups.set(kitId, {
        kitName: asset.kit!.name,
        kitLocationName: asset.kit!.location?.name ?? null,
        assets: [],
      });
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
      case "location": {
        const locA = a.location?.name;
        const locB = b.location?.name;
        // Null locations go to the end regardless of direction
        if (!locA && locB) return 1;
        if (locA && !locB) return -1;
        if (!locA && !locB) return a.title.localeCompare(b.title);
        return multiplier * locA!.localeCompare(locB!);
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
        case "location": {
          const locA = groupA.kitLocationName;
          const locB = groupB.kitLocationName;
          // Null locations go to the end regardless of direction
          if (!locA && locB) return 1;
          if (locA && !locB) return -1;
          if (!locA && !locB)
            return groupA.kitName.localeCompare(groupB.kitName);
          return multiplier * locA!.localeCompare(locB!);
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

/**
 * Minimal asset shape needed for in-memory booking search. Mirrors the fields
 * selected by `BOOKING_WITH_ASSETS_INCLUDE.assets.select`. Relation fields are
 * optional/nullable to allow structural subtyping against the richer Prisma
 * asset payload.
 *
 * @see {@link file://./constants.ts} BOOKING_WITH_ASSETS_INCLUDE.assets.select
 */
export type SearchableBookingAsset = {
  id: string;
  kitId: string | null;
  title: string;
  sequentialId?: string | null;
  category?: { name: string } | null;
  tags?: { name: string }[] | null;
  location?: { name: string } | null;
  qrCodes?: { id: string }[] | null;
  barcodes?: { value: string }[] | null;
  kit?: {
    name?: string | null;
    location?: { name: string } | null;
    category?: { name: string } | null;
  } | null;
};

/**
 * Splits a raw search string into lowercased, trimmed, non-empty terms.
 * Commas separate terms (comma = OR).
 *
 * @param search - Raw search string from the `s` query param
 * @returns Array of normalized terms (empty if the input is blank)
 */
function parseBookingSearchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .trim()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * True when `term` is a case-insensitive substring of any searchable field of
 * the asset (its own fields, its tags/codes, or its kit's fields).
 *
 * @param asset - The asset to test
 * @param term - An already-lowercased search term
 */
function assetMatchesBookingTerm(
  asset: SearchableBookingAsset,
  term: string
): boolean {
  const haystacks: (string | null | undefined)[] = [
    asset.title,
    asset.sequentialId,
    asset.category?.name,
    asset.location?.name,
    asset.kit?.name,
    asset.kit?.location?.name,
    asset.kit?.category?.name,
    ...(asset.tags?.map((tag) => tag.name) ?? []),
    ...(asset.qrCodes?.map((qr) => qr.id) ?? []),
    ...(asset.barcodes?.map((barcode) => barcode.value) ?? []),
  ];

  return haystacks.some(
    (value) => value != null && value.toLowerCase().includes(term)
  );
}

/**
 * In-memory replacement for the old Prisma multi-relation `OR` search on a
 * booking's assets. An asset matches if ANY comma-separated term is a
 * case-insensitive substring of ANY of its searchable fields. A match inside a
 * kit re-expands to surface the ENTIRE kit (all sibling assets).
 *
 * Input order is preserved (callers sort afterwards). Blank/missing search
 * returns the input array unchanged.
 *
 * @param assets - The booking's full asset list
 * @param search - Raw search string from the `s` query param (may be blank)
 * @returns The filtered subset (with kits re-expanded)
 */
export function filterBookingAssets<T extends SearchableBookingAsset>(
  assets: T[],
  search: string | null | undefined
): T[] {
  const terms = search ? parseBookingSearchTerms(search) : [];
  if (terms.length === 0) {
    return assets;
  }

  // Comma = OR: an asset matches if any term matches any of its fields.
  const directMatches = assets.filter((asset) =>
    terms.some((term) => assetMatchesBookingTerm(asset, term))
  );

  // Kit re-expansion: a matched asset surfaces its whole kit.
  const matchedKitIds = new Set(
    directMatches
      .map((asset) => asset.kitId)
      .filter((kitId): kitId is string => Boolean(kitId))
  );
  if (matchedKitIds.size === 0) {
    return directMatches;
  }

  const directIds = new Set(directMatches.map((asset) => asset.id));
  return assets.filter(
    (asset) =>
      directIds.has(asset.id) ||
      (asset.kitId != null && matchedKitIds.has(asset.kitId))
  );
}
