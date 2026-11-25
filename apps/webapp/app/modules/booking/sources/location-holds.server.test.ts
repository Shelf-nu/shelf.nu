/**
 * `loadReservedNextAtLocation`: units reserved next at a location per pool.
 *
 * @see {@link file://./location-holds.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";

import {
  loadOperatorCustodyByPool,
  loadReservedNextAtLocation,
} from "./location-holds.server";

// why: the reader goes through Prisma; each case stages the rows it returns
vi.mock("~/database/db.server", () => ({
  db: {
    bookingAsset: { findMany: vi.fn() },
    bookingAssetSource: { findMany: vi.fn() },
    custody: { groupBy: vi.fn() },
  },
}));

const ORG = "org-1";
const NOW = new Date("2026-12-01T09:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("loadReservedNextAtLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one probe and nothing else while no slice has planned sources", async () => {
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([]);

    const result = await loadReservedNextAtLocation({
      organizationId: ORG,
      locationId: "loc-a",
      assetIds: ["cables"],
      now: NOW,
    });

    expect(result.reservedNext.size).toBe(0);
    expect(result.convertedAssetIds.size).toBe(0);
    expect(db.bookingAsset.findMany).toHaveBeenCalledTimes(1);
    expect(db.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: { in: ["cables"] },
          sourceAllocation: { in: ["AUTO", "MANUAL"] },
          booking: {
            organizationId: ORG,
            status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
          },
        }),
      })
    );
    expect(db.bookingAssetSource.findMany).not.toHaveBeenCalled();
  });

  it("reports the peak of pending units over the next booking window", async () => {
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      {
        id: "ba-1",
        assetId: "cables",
        booking: { from: day(1), to: day(3), status: "RESERVED" },
      },
      {
        id: "ba-2",
        assetId: "cables",
        booking: { from: day(8), to: day(10), status: "RESERVED" },
      },
      {
        id: "ba-3",
        assetId: "tape",
        booking: { from: day(-1), to: day(2), status: "ONGOING" },
      },
    ] as never);
    vi.mocked(db.bookingAssetSource.findMany).mockResolvedValue([
      {
        bookingAssetId: "ba-1",
        quantity: 3,
        outQuantity: 0,
        releasedQuantity: 0,
      },
      {
        bookingAssetId: "ba-2",
        quantity: 3,
        outQuantity: 0,
        releasedQuantity: 0,
      },
      // 4 planned, 4 out: nothing still to leave.
      {
        bookingAssetId: "ba-3",
        quantity: 4,
        outQuantity: 4,
        releasedQuantity: 0,
      },
    ] as never);

    const result = await loadReservedNextAtLocation({
      organizationId: ORG,
      locationId: "loc-a",
      assetIds: ["cables", "tape"],
      now: NOW,
    });

    expect([...result.reservedNext]).toEqual([["cables", 3]]);
    // Both pools are converted, whether or not anything is still to leave.
    expect([...result.convertedAssetIds]).toEqual(["cables", "tape"]);
    expect(db.bookingAssetSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG,
          locationId: "loc-a",
          kind: "LOCATION",
          bookingAssetId: { in: ["ba-1", "ba-2", "ba-3"] },
        },
      })
    );
  });

  it("keeps a hold at a placement reduced to 0", async () => {
    // The placement is gone or 0; the row still holds 5 pending there.
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      {
        id: "ba-1",
        assetId: "cables",
        booking: { from: day(1), to: day(2), status: "RESERVED" },
      },
    ] as never);
    vi.mocked(db.bookingAssetSource.findMany).mockResolvedValue([
      {
        bookingAssetId: "ba-1",
        quantity: 5,
        outQuantity: 0,
        releasedQuantity: 0,
      },
    ] as never);

    const result = await loadReservedNextAtLocation({
      organizationId: ORG,
      locationId: "loc-a",
      assetIds: ["cables"],
      now: NOW,
    });

    expect(result.reservedNext.get("cables")).toBe(5);
  });
});

describe("loadOperatorCustodyByPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums operator custody per pool, leaving kit custody out", async () => {
    vi.mocked(db.custody.groupBy).mockResolvedValue([
      { assetId: "cables", _sum: { quantity: 2 } },
      { assetId: "tape", _sum: { quantity: 0 } },
    ] as never);

    const result = await loadOperatorCustodyByPool({
      organizationId: ORG,
      assetIds: ["cables", "tape"],
    });

    expect([...result]).toEqual([["cables", 2]]);
    expect(db.custody.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: {
        assetId: { in: ["cables", "tape"] },
        kitCustodyId: null,
        asset: { organizationId: ORG },
      },
      _sum: { quantity: true },
    });
  });

  it("reads nothing for no pools", async () => {
    const result = await loadOperatorCustodyByPool({
      organizationId: ORG,
      assetIds: [],
    });

    expect(result.size).toBe(0);
    expect(db.custody.groupBy).not.toHaveBeenCalled();
  });
});
