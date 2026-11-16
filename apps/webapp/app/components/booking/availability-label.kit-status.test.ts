/**
 * `getKitAvailabilityStatus` — kit-driven "Already booked" signal.
 *
 * Co-located (rather than added to `test/components/booking/availability-label.test.tsx`)
 * because that suite mocks `~/modules/booking/helpers` wholesale, which would
 * silently stub out `hasKitBookingConflicts` too. These cases exist
 * specifically to prove the REAL `hasKitBookingConflicts` fires for a kit
 * whose members are all QUANTITY_TRACKED: `hasAssetBookingConflicts` exempts
 * that asset type, so a kit made only of QUANTITY_TRACKED members needs
 * `hasKitBookingConflicts` to ever show "Already booked".
 *
 * @see {@link file://./availability-label.tsx}
 * @see {@link file://../../modules/booking/helpers.ts} hasKitBookingConflicts
 */
import {
  AssetStatus,
  AssetType,
  BookingStatus,
  KitStatus,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { getKitAvailabilityStatus } from "~/components/booking/availability-label";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-kits";

/** One `BookingAsset` row shape as it survives to `ak.asset.bookingAssets`. */
type FixtureBookingAsset = {
  assetKitId: string | null;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
  booking: { id: string; status: BookingStatus };
};

/**
 * One `AssetKit` membership, with a single QUANTITY_TRACKED member asset —
 * the shape that made `hasAssetBookingConflicts` alone insufficient, since it
 * always exempts that asset type.
 */
function createMembership({
  membershipId,
  bookingAssets = [],
}: {
  membershipId: string;
  bookingAssets?: FixtureBookingAsset[];
}) {
  return {
    id: membershipId,
    asset: {
      id: `asset-${membershipId}`,
      type: AssetType.QUANTITY_TRACKED,
      status: AssetStatus.AVAILABLE,
      availableToBook: true,
      custody: [],
      bookingAssets,
    },
  };
}

/**
 * A `KitForBooking` fixture with only the fields `getKitAvailabilityStatus`
 * reads. Cast through `unknown` — like the sibling fixtures in
 * `kit-row.test.tsx` — since `Kit`'s full scalar set is irrelevant here.
 */
function createKit(
  assetKits: ReturnType<typeof createMembership>[]
): KitForBooking {
  return {
    id: "kit-1",
    status: KitStatus.AVAILABLE,
    assetKits,
  } as unknown as KitForBooking;
}

describe("getKitAvailabilityStatus — kit-driven conflict signal (QT-only kit)", () => {
  const CURRENT_BOOKING_ID = "current-booking";

  it("flags the kit when another RESERVED booking holds one of its kit-driven slices", () => {
    const kit = createKit([
      createMembership({
        membershipId: "ak-1",
        bookingAssets: [
          {
            assetKitId: "ak-1",
            checkedOutAt: null,
            checkedInAt: null,
            booking: { id: "other-booking", status: BookingStatus.RESERVED },
          },
        ],
      }),
    ]);

    const result = getKitAvailabilityStatus(kit, CURRENT_BOOKING_ID);

    expect(result.someAssetHasUnavailableBooking).toBe(true);
  });

  it("does not flag the kit once another ONGOING booking has returned all its kit slices", () => {
    const kit = createKit([
      createMembership({
        membershipId: "ak-1",
        bookingAssets: [
          {
            assetKitId: "ak-1",
            checkedOutAt: new Date("2024-01-01T09:00:00Z"),
            checkedInAt: new Date("2024-01-02T09:00:00Z"),
            booking: { id: "other-booking", status: BookingStatus.ONGOING },
          },
        ],
      }),
    ]);

    const result = getKitAvailabilityStatus(kit, CURRENT_BOOKING_ID);

    expect(result.someAssetHasUnavailableBooking).toBe(false);
  });

  it("does not flag the kit for a standalone row of the same asset on another booking", () => {
    const kit = createKit([
      createMembership({
        membershipId: "ak-1",
        bookingAssets: [
          // Standalone slice of the same asset (`assetKitId` null) — the
          // asset's free pool, not this membership.
          {
            assetKitId: null,
            checkedOutAt: null,
            checkedInAt: null,
            booking: { id: "other-booking", status: BookingStatus.RESERVED },
          },
          // Kit-driven slice booked under a DIFFERENT membership of the same
          // asset (the asset belongs to more than one kit).
          {
            assetKitId: "ak-2",
            checkedOutAt: null,
            checkedInAt: null,
            booking: {
              id: "other-booking-2",
              status: BookingStatus.RESERVED,
            },
          },
        ],
      }),
    ]);

    const result = getKitAvailabilityStatus(kit, CURRENT_BOOKING_ID);

    expect(result.someAssetHasUnavailableBooking).toBe(false);
  });

  it("does not flag the kit for its own booking's slice", () => {
    const kit = createKit([
      createMembership({
        membershipId: "ak-1",
        bookingAssets: [
          {
            assetKitId: "ak-1",
            checkedOutAt: null,
            checkedInAt: null,
            booking: {
              id: CURRENT_BOOKING_ID,
              status: BookingStatus.RESERVED,
            },
          },
        ],
      }),
    ]);

    const result = getKitAvailabilityStatus(kit, CURRENT_BOOKING_ID);

    expect(result.someAssetHasUnavailableBooking).toBe(false);
  });
});
