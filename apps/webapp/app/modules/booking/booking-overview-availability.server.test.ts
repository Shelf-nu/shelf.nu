/**
 * Unit tests for `buildAvailableUnitsByAsset`
 * (`booking-overview-availability.server.ts`).
 *
 * The builder is a thin adapter over `getAssetAvailabilityBatch`: it maps
 * the batch result's `.bookable` / `.physicalAvailable` / `.reserved`
 * fields onto the `{ bookable, physicalNow, reserved }` shape the
 * booking-overview UI consumes (RED "Insufficient stock" vs AMBER "pending
 * return" badges — see `resolveQtyStockBadgeVariant` in
 * `~/utils/booking-assets` — plus the "Adjust booked quantity" dialog's
 * windowed max + "reserved by other bookings" note). We stub
 * `getAssetAvailabilityBatch` itself rather than the database — its own
 * windowed-availability logic has dedicated coverage in
 * `~/modules/asset/availability.server.test.ts`, so this file focuses on
 * the adapter's mapping/clamping behavior.
 */
import { describe, expect, it, vitest } from "vitest";

// why: isolate the adapter under test from `getAssetAvailabilityBatch`'s own
// windowed-availability computation (separately covered in
// `availability.server.test.ts`) — we only need to control what it returns.
const getAssetAvailabilityBatchMock = vitest.fn();
vitest.mock("~/modules/asset/availability.server", () => ({
  getAssetAvailabilityBatch: (...args: unknown[]) =>
    getAssetAvailabilityBatchMock(...args),
}));

import { buildAvailableUnitsByAsset } from "./booking-overview-availability.server";

/** Minimal `AssetAvailability` stub — only the fields the adapter reads. */
function availabilityEntry(
  bookable: number,
  physicalAvailable: number,
  reserved: number
) {
  return { bookable, physicalAvailable, reserved } as {
    bookable: number;
    physicalAvailable: number;
    reserved: number;
  };
}

describe("buildAvailableUnitsByAsset", () => {
  it("maps .bookable/.physicalAvailable/.reserved onto { bookable, physicalNow, reserved } per QT asset", async () => {
    expect.assertions(1);
    // Boards: 10 total, 7 currently checked out elsewhere (physicalNow = 3),
    // but that checkout ends before this booking's window starts, so the
    // windowed `bookable` figure is the full 10 — the "returning in time"
    // case the AMBER badge exists for. `reserved` (2) is what OTHER
    // bookings hold within this booking's window — the figure the "Adjust
    // booked quantity" dialog uses to explain why `bookable` < workspace
    // total.
    getAssetAvailabilityBatchMock.mockResolvedValue(
      new Map([["asset-boards", availabilityEntry(10, 3, 2)]])
    );

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-boards", type: "QUANTITY_TRACKED" }],
      qtyAssetIdsInBooking: ["asset-boards"],
      organizationId: "org-1",
      booking: {
        id: "booking-1",
        from: new Date("2026-08-01T00:00:00Z"),
        to: new Date("2026-08-05T00:00:00Z"),
      },
    });

    expect(result).toEqual({
      "asset-boards": { bookable: 10, physicalNow: 3, reserved: 2 },
    });
  });

  it("clamps bookable, physicalNow, and reserved to 0 when the batch result is negative", async () => {
    expect.assertions(1);
    getAssetAvailabilityBatchMock.mockResolvedValue(
      new Map([["asset-over-committed", availabilityEntry(-4, -2, -1)]])
    );

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-over-committed", type: "QUANTITY_TRACKED" }],
      qtyAssetIdsInBooking: ["asset-over-committed"],
      organizationId: "org-1",
      booking: { id: "booking-1", from: null, to: null },
    });

    expect(result).toEqual({
      "asset-over-committed": { bookable: 0, physicalNow: 0, reserved: 0 },
    });
  });

  it("defaults to { bookable: 0, physicalNow: 0, reserved: 0 } when the batch has no entry for the asset", async () => {
    expect.assertions(1);
    getAssetAvailabilityBatchMock.mockResolvedValue(new Map());

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-missing", type: "QUANTITY_TRACKED" }],
      qtyAssetIdsInBooking: ["asset-missing"],
      organizationId: "org-1",
      booking: { id: "booking-1", from: null, to: null },
    });

    expect(result).toEqual({
      "asset-missing": { bookable: 0, physicalNow: 0, reserved: 0 },
    });
  });

  it("skips INDIVIDUAL assets — only QUANTITY_TRACKED entries are surfaced", async () => {
    expect.assertions(1);
    getAssetAvailabilityBatchMock.mockResolvedValue(
      new Map([["asset-qt", availabilityEntry(5, 5, 0)]])
    );

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [
        { id: "asset-individual", type: "INDIVIDUAL" },
        { id: "asset-qt", type: "QUANTITY_TRACKED" },
      ],
      qtyAssetIdsInBooking: ["asset-qt"],
      organizationId: "org-1",
      booking: { id: "booking-1", from: null, to: null },
    });

    expect(result).toEqual({
      "asset-qt": { bookable: 5, physicalNow: 5, reserved: 0 },
    });
  });
});
