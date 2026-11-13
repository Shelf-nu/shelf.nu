/**
 * Real-database fixtures
 *
 * Inserts the minimum valid rows real-database tests build on: a user, a
 * workspace, a QUANTITY_TRACKED asset pool with per-location placements, and
 * bookings with their slices. Every fixture takes the client to write with,
 * so it works on the shared test client and inside a transaction alike.
 *
 * Values that carry a unique constraint (the user's email) are randomised so
 * committed fixtures never collide across reruns.
 *
 * @see {@link file://./client.ts} the client and transaction helpers.
 */

import { randomUUID } from "node:crypto";

import type { BookingStatus } from "@shelf/database";

import type { TxClient } from "./client";

/** Options for {@link seedOrgWithPool}. */
export type SeedOrgWithPoolOptions = {
  /** One `AssetLocation` row per entry, each at its own new location. */
  placements: Array<{ name: string; quantity: number }>;
  /** `Asset.quantity`: the pool's workspace stock. */
  total: number;
};

/** Ids created by {@link seedOrgWithPool}. */
export type SeededOrgWithPool = {
  organizationId: string;
  assetId: string;
  /** Location ids in the same order as `placements`. */
  locationIds: string[];
  userId: string;
};

/**
 * Creates a user, a workspace owned by that user, a QUANTITY_TRACKED asset
 * holding `total` units, and one location plus `AssetLocation` placement per
 * entry in `placements`.
 *
 * The `AssetLocation` sum trigger rejects placements above `Asset.quantity`,
 * so the placements are checked here first to fail with a clear message.
 *
 * @param db - Client or transaction client to write with.
 * @param opts - Pool total and placements.
 * @returns The created ids.
 * @throws {Error} When the placements add up to more than `total`.
 */
export async function seedOrgWithPool(
  db: TxClient,
  opts: SeedOrgWithPoolOptions
): Promise<SeededOrgWithPool> {
  const placed = opts.placements.reduce((sum, p) => sum + p.quantity, 0);
  if (placed > opts.total) {
    throw new Error(
      `seedOrgWithPool: placements add up to ${placed}, above the pool total ${opts.total}.`
    );
  }

  const suffix = randomUUID();
  const user = await db.user.create({
    data: { email: `db-test-${suffix}@example.com`, firstName: "Db" },
    select: { id: true },
  });

  const organization = await db.organization.create({
    data: { name: `Db test ${suffix}`, type: "TEAM", userId: user.id },
    select: { id: true },
  });

  const asset = await db.asset.create({
    data: {
      title: "Pool asset",
      type: "QUANTITY_TRACKED",
      quantity: opts.total,
      consumptionType: "TWO_WAY",
      userId: user.id,
      organizationId: organization.id,
    },
    select: { id: true },
  });

  const locationIds: string[] = [];
  for (const placement of opts.placements) {
    const location = await db.location.create({
      data: {
        name: placement.name,
        userId: user.id,
        organizationId: organization.id,
      },
      select: { id: true },
    });
    await db.assetLocation.create({
      data: {
        assetId: asset.id,
        locationId: location.id,
        organizationId: organization.id,
        quantity: placement.quantity,
      },
    });
    locationIds.push(location.id);
  }

  return {
    organizationId: organization.id,
    assetId: asset.id,
    locationIds,
    userId: user.id,
  };
}

/** One booking slice for {@link seedBooking}. */
export type SeedBookingSlice = {
  assetId: string;
  /** Booked units (`BookingAsset.quantity`). */
  quantity: number;
  assetKitId?: string;
  checkedOutQuantity?: number;
  sourceLocationId?: string;
};

/** Options for {@link seedBooking}. */
export type SeedBookingOptions = {
  organizationId: string;
  /** Becomes the booking's creator. */
  userId: string;
  status: BookingStatus;
  from: Date;
  to: Date;
  slices: SeedBookingSlice[];
};

/** Ids created by {@link seedBooking}. */
export type SeededBooking = {
  bookingId: string;
  /** `BookingAsset` ids in the same order as `slices`. */
  sliceIds: string[];
};

/**
 * Creates a booking and one `BookingAsset` slice per entry in `slices`.
 *
 * @param db - Client or transaction client to write with.
 * @param opts - Booking fields and its slices.
 * @returns The booking id and slice ids.
 */
export async function seedBooking(
  db: TxClient,
  opts: SeedBookingOptions
): Promise<SeededBooking> {
  const booking = await db.booking.create({
    data: {
      name: "Db test booking",
      status: opts.status,
      from: opts.from,
      to: opts.to,
      creatorId: opts.userId,
      organizationId: opts.organizationId,
    },
    select: { id: true },
  });

  const sliceIds: string[] = [];
  for (const slice of opts.slices) {
    const created = await db.bookingAsset.create({
      data: {
        bookingId: booking.id,
        assetId: slice.assetId,
        quantity: slice.quantity,
        assetKitId: slice.assetKitId ?? null,
        checkedOutQuantity: slice.checkedOutQuantity ?? 0,
        sourceLocationId: slice.sourceLocationId ?? null,
      },
      select: { id: true },
    });
    sliceIds.push(created.id);
  }

  return { bookingId: booking.id, sliceIds };
}
