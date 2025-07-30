# Booking Conflict Queries & Reservation Logic

This document provides comprehensive documentation for all booking conflict detection patterns used throughout the Shelf.nu codebase. Understanding these patterns is crucial for maintaining consistency when modifying booking-related functionality.

## Overview

Shelf.nu uses three distinct patterns for handling booking conflicts and asset availability:

1. **[Booking Conflict Detection](#pattern-1-booking-conflict-detection)** - Finding conflicting bookings for availability labels
2. **[Asset/Kit Filtering](#pattern-2-assetkit-filtering)** - Filtering unavailable assets/kits from query results
3. **[Server-side Availability Logic](#pattern-3-server-side-availability-logic)** - Computing availability status for UI components

## Core Business Rules

### Booking Status Hierarchy

1. **RESERVED** bookings always conflict with overlapping date ranges
2. **ONGOING/OVERDUE** bookings only conflict if the asset is actually `CHECKED_OUT`
3. **AVAILABLE** assets from partial check-ins can be re-booked even if the original booking is still ongoing

### Date Range Overlap Logic

Two bookings conflict if their date ranges overlap. This is determined by:

```sql
-- Booking A overlaps with Booking B if:
(A.from <= B.to AND A.to >= B.from) OR (A.from >= B.from AND A.to <= B.to)
```

## Pattern 1: Booking Conflict Detection

**Purpose**: Find conflicting bookings to populate availability labels and compute booking flags.

**Used in**:

- `app/routes/_layout+/bookings.$bookingId.tsx` - `loader()` function, asset details query
- `app/modules/booking/service.server.ts` - `getBookingFlags()` function

### Query Structure

```typescript
bookings: {
  where: {
    ...(booking.from && booking.to
      ? {
          OR: [
            // Include current booking for isCheckedOut logic
            { id: booking.id },
            // Rule 1: RESERVED bookings always conflict
            {
              status: "RESERVED",
              id: { not: booking.id }, // Exclude current booking from conflicts
              OR: [
                {
                  from: { lte: booking.to },
                  to: { gte: booking.from },
                },
                {
                  from: { gte: booking.from },
                  to: { lte: booking.to },
                },
              ],
            },
            // Rule 2: ONGOING/OVERDUE bookings (filtered by asset status in isAssetAlreadyBooked logic)
            {
              status: { in: ["ONGOING", "OVERDUE"] },
              id: { not: booking.id }, // Exclude current booking from conflicts
              OR: [
                {
                  from: { lte: booking.to },
                  to: { gte: booking.from },
                },
                {
                  from: { gte: booking.from },
                  to: { lte: booking.to },
                },
              ],
            },
          ],
        }
      : {}),
  },
},
```

### Key Features

- **Includes current booking**: Needed for `isCheckedOut` logic in UI components
- **Excludes current booking from conflicts**: Prevents self-conflicts in availability detection
- **Date-range aware**: Only applies conflict logic when booking has dates
- **Two-tier conflict rules**: Different handling for RESERVED vs ONGOING/OVERDUE

## Pattern 2: Asset/Kit Filtering

**Purpose**: Filter out unavailable assets/kits from query results based on booking conflicts.

**Used in**:

- `app/modules/asset/service.server.ts` - `getAssets()` function (when `hideUnavailable` is true)
- `app/modules/kit/service.server.ts` - `getKits()` function (when `hideUnavailable` is true) ⚠️ **NEEDS UPDATE**

### Asset Query Structure (Updated for Partial Check-ins)

```typescript
// Inside getAssets() function when hideUnavailable === true
const where: Prisma.AssetWhereInput[] = [
  // Rule 1: RESERVED bookings always exclude assets
  {
    bookings: {
      none: {
        id: { not: currentBookingId },
        status: BookingStatus.RESERVED,
        OR: [
          { from: { lte: bookingTo }, to: { gte: bookingFrom } },
          { from: { gte: bookingFrom }, to: { lte: bookingTo } },
        ],
      },
    },
  },
  // Rule 2: For ONGOING/OVERDUE bookings, only exclude CHECKED_OUT assets
  {
    OR: [
      // Either asset is AVAILABLE (checked in from partial check-in)
      { status: AssetStatus.AVAILABLE },
      // Or asset has no conflicting ONGOING/OVERDUE bookings
      {
        bookings: {
          none: {
            ...(unhideAssetsBookigIds?.length && {
              id: { notIn: unhideAssetsBookigIds },
            }),
            status: {
              in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
            },
            OR: [
              { from: { lte: bookingTo }, to: { gte: bookingFrom } },
              { from: { gte: bookingFrom }, to: { lte: bookingTo } },
            ],
          },
        },
      },
    ],
  },
];
```

### Kit Query Structure (✅ **UPDATED**)

```typescript
// Inside getKits() function - Now handles partial check-ins properly
if (bookingFrom && bookingTo) {
  // Apply booking conflict logic similar to assets, but through kit assets
  const kitWhere: Prisma.KitWhereInput[] = [
    // Rule 1: RESERVED bookings always exclude kits (if any asset is in a RESERVED booking)
    {
      assets: {
        none: {
          bookings: {
            some: {
              id: { not: currentBookingId },
              status: BookingStatus.RESERVED,
              OR: [
                { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                { from: { gte: bookingFrom }, to: { lte: bookingTo } },
              ],
            },
          },
        },
      },
    },
    // Rule 2: For ONGOING/OVERDUE bookings, allow kits that are AVAILABLE or have no conflicting assets
    {
      OR: [
        // Either kit is AVAILABLE (checked in from partial check-in)
        { status: KitStatus.AVAILABLE },
        // Or kit has no assets in conflicting ONGOING/OVERDUE bookings
        {
          assets: {
            none: {
              bookings: {
                some: {
                  id: { not: currentBookingId },
                  status: {
                    in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                  },
                  OR: [
                    { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                    { from: { gte: bookingFrom }, to: { lte: bookingTo } },
                  ],
                },
              },
            },
          },
        },
      ],
    },
  ];

  // Combine the basic filters with booking conflict filters
  where.AND = kitWhere;
}
```

### Key Features

- **Negative filtering**: Uses `none` to exclude conflicted assets/kits
- **Partial check-in aware**: Assets with `AVAILABLE` status can be re-booked
- **Booking exclusion**: Can exclude specific bookings via `unhideAssetsBookigIds`

## Pattern 3: Server-side Availability Logic

**Purpose**: Centralized logic for computing asset availability status.

**Used in**:

- `app/modules/booking/helpers.ts` - `hasAssetBookingConflicts()` and `isAssetAlreadyBooked()` functions  
- `app/modules/booking/utils.server.ts` - Server-side utilities and route helpers
- Called from multiple booking routes and UI components

### Core Functions: Centralized Conflict Logic

```typescript
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
```

### Usage Pattern

```typescript
// 1. Fetch assets with all relevant bookings (server-side)
const assets = await db.asset.findMany({
  include: {
    bookings: {
      where: createBookingConflictConditions({
        currentBookingId: booking.id,
        fromDate: booking.from,
        toDate: booking.to,
        includeCurrentBooking: true, // Important for isCheckedOut logic
      }),
    },
  },
});

// 2. Return raw asset data (no server-side computation)
return json({ assets }); // Simple, no enrichment

// 3. Use helper functions client-side
const isAlreadyBooked = hasAssetBookingConflicts(asset, booking.id);
if (isAlreadyBooked) {
  // Show conflict label
}
```

### Key Features

- **Excludes current booking**: Prevents self-conflicts
- **Status-aware**: Different logic for RESERVED vs ONGOING/OVERDUE
- **Partial check-in compatible**: Respects asset status in conflict detection

## UI Component Integration

### AvailabilityLabel Component

The availability label component relies on proper data enrichment:

```typescript
// In list-asset-content.tsx - inside component function
const isCheckedOut = useMemo(
  () =>
    (item.status === AssetStatus.CHECKED_OUT &&
      !item.bookings.some((b) => b.id === booking.id)) ??
    false,
  [item.status, item.bookings, booking.id]
);

// Shows "Checked out" only if asset is checked out in a DIFFERENT booking
<AvailabilityLabel asset={item} isCheckedOut={isCheckedOut} />
```

### KitRow Component

The kit row component uses centralized logic for consistent availability checking:

```typescript
// In kit-row.tsx - inside component function
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";

// Kit is overlapping if it's not AVAILABLE and has conflicting bookings
// Use centralized booking conflict logic
const isOverlapping =
  kit.status !== "AVAILABLE" &&
  assets.some((asset) => hasAssetBookingConflicts(asset, bookingId));

// Only shows "Already booked" badge if isOverlapping is true
<When truthy={isOverlapping}>
  <AvailabilityBadge badgeText="Already booked" ... />
</When>
```

### getKitAvailabilityStatus Function

The kit availability status function also uses centralized logic:

```typescript
// In availability-label.tsx - getKitAvailabilityStatus function
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";

// Kit is checked out if it's not AVAILABLE and has conflicting bookings
const isCheckedOut =
  kit.status !== "AVAILABLE" &&
  kit.assets.some((asset) => hasAssetBookingConflicts(asset, currentBookingId));

// Apply same booking conflict logic for unavailable bookings
const someAssetHasUnavailableBooking = kit.assets.some((asset) =>
  hasAssetBookingConflicts(asset, currentBookingId)
);
```

### Critical Requirements

1. **Current booking inclusion**: Asset bookings must include the current booking for `isCheckedOut` logic
2. **Conflict exclusion**: Availability logic must exclude current booking from conflicts
3. **Status awareness**: Must respect asset status for partial check-in scenarios

## Common Pitfalls & Debugging

### Issue: Assets show "Checked out" when they shouldn't

**Cause**: Current booking excluded from asset bookings query
**Solution**: Include current booking in query (see Pattern 1)

### Issue: Assets can't be added to new bookings after partial check-in

**Cause**: Query doesn't account for `AVAILABLE` status from partial check-ins
**Solution**: Update filtering logic (see Pattern 2 asset example)

### Issue: Inconsistent availability between different pages

**Cause**: Different queries using different patterns
**Solution**: Standardize using documented patterns

## Files & Functions to Update When Modifying Logic

When changing booking conflict logic, ensure you update ALL of these locations:

### Pattern 1 (Booking Conflict Detection)

- `app/routes/_layout+/bookings.$bookingId.tsx` - `loader()` function
- `app/modules/booking/service.server.ts` - `getBookingFlags()` function

### Pattern 2 (Asset/Kit Filtering)

- `app/modules/asset/service.server.ts` - `getAssets()` function
- `app/modules/kit/service.server.ts` - `getKits()` function ⚠️ **NEEDS UPDATE**

### Pattern 3 (Availability Logic)

- `app/modules/booking/helpers.ts` - `hasAssetBookingConflicts()` and `isAssetAlreadyBooked()` functions  
- `app/modules/booking/utils.server.ts` - Server-side utilities and route helpers

### UI Components

- `app/components/booking/availability-label.tsx` - `AvailabilityLabel()` component
- `app/components/booking/list-asset-content.tsx` - Asset row component with `isCheckedOut` logic
- `app/components/booking/kit-row.tsx` - `KitRow()` component with `isOverlapping` logic

## Recent Updates

### ✅ Kit Filtering Logic Updated

- **Fixed**: `app/modules/kit/service.server.ts` `getKits()` function now properly handles partial check-ins
- **Change**: Kit availability now respects `KitStatus.AVAILABLE` and checks asset conflicts through proper relationships
- **Impact**: Kits with partial check-ins are now available for new bookings

### ✅ Kit UI Component Logic Updated

- **Fixed**: `app/components/booking/kit-row.tsx` `isOverlapping` logic now matches backend business rules
- **Change**: Kits with `AVAILABLE` status no longer show "Already booked" labels
- **Impact**: Consistent kit availability display across manage-kits and main booking pages

### ✅ Logic Centralization & Code Deduplication

- **Added**: `hasAssetBookingConflicts()` function in `app/modules/booking/helpers.ts`
- **Moved**: Functions from `utils.server.ts` to `helpers.ts` to fix client/server import issues
- **Refactored**: All duplicate booking conflict logic now uses centralized function
- **Updated**: `KitRow`, `getKitAvailabilityStatus` now use shared logic
- **Impact**: Reduced code duplication, easier maintenance, consistent behavior, proper client/server separation

## Status Summary

| Pattern                        | Assets     | Kits           | Status       |
| ------------------------------ | ---------- | -------------- | ------------ |
| Pattern 1: Booking Conflicts   | ✅ Updated | ✅ Updated     | Complete     |
| Pattern 2: Asset/Kit Filtering | ✅ Updated | ✅ **Updated** | **Complete** |
| Pattern 3: Availability Logic  | ✅ Updated | ✅ Updated     | Complete     |
| UI Components                  | ✅ Updated | ✅ **Updated** | **Complete** |

## Next Steps

1. Consider creating reusable constants for common query patterns to reduce duplication
2. Add unit tests for booking conflict edge cases with kits and partial check-ins
3. Monitor for any edge cases in production with the new kit logic
