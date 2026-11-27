import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countUnitsOnBookingsFromLocation,
  loadBookedOutBySource,
  unitsStillOutBySlice,
} from "./units-out-by-source.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  bookingAsset: { findMany: vi.fn() },
  bookingAssetSource: { findMany: vi.fn() },
  consumptionLog: { findMany: vi.fn() },
}));

// why: the location-page count reads through the root `db`; stubbing its three
// delegates lets each case state the rows and observe which reads happen,
// without opening a connection.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const slice = {
  id: "ba-1",
  bookingId: "b-1",
  assetId: "pool-1",
  quantity: 10,
  assetKitId: null,
  checkedOutQuantity: 10,
  checkedOutAt: new Date("2026-01-05T09:00:00.000Z"),
};

describe("unitsStillOutBySlice", () => {
  it("subtracts the logs that name the slice", () => {
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: "ba-1",
          quantity: 4,
        },
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: "ba-1",
          quantity: 2,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(4);
  });

  it("counts a log from an older app that names no slice against the asset's only slice", () => {
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 6,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(4);
  });

  it("fills untagged units in the booking page's order: standalone slice first", () => {
    const kitSlice = {
      ...slice,
      id: "ba-kit",
      assetKitId: "ak-1",
      quantity: 5,
      checkedOutQuantity: 5,
    };
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice, kitSlice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 7,
        },
      ],
    });
    // The standalone slice takes all 7 before the kit slice gets any.
    expect(out.get("ba-1")).toBe(3);
  });

  it("lets untagged returns cover every trip a slice made, not one booked quantity", () => {
    // Out twice (10 + 10), back twice from an older app that names no slice.
    const twice = { ...slice, checkedOutQuantity: 20 };
    const out = unitsStillOutBySlice({
      sourced: [twice],
      siblings: [twice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 10,
        },
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 10,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(0);
  });

  it("gives an untagged return nothing on a sibling that never went out", () => {
    // The loose slice is booked but still on the shelf; the kit slice sent 5.
    const kitSlice = {
      ...slice,
      id: "ba-kit",
      assetKitId: "ak-1",
      quantity: 5,
      checkedOutQuantity: 5,
    };
    const out = unitsStillOutBySlice({
      sourced: [kitSlice],
      siblings: [
        { ...slice, checkedOutQuantity: 0, checkedOutAt: null },
        kitSlice,
      ],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 3,
        },
      ],
    });
    expect(out.get("ba-kit")).toBe(2);
  });

  it("caps a partly dispatched slice at the units it sent", () => {
    // 4 of 10 booked loose units left and came back; 3 more belong to the kit.
    const partly = { ...slice, checkedOutQuantity: 4 };
    const kitSlice = {
      ...slice,
      id: "ba-kit",
      assetKitId: "ak-1",
      quantity: 5,
      checkedOutQuantity: 5,
    };
    const out = unitsStillOutBySlice({
      sourced: [partly, kitSlice],
      siblings: [partly, kitSlice],
      logs: [
        {
          bookingId: "b-1",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 7,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(0);
    expect(out.get("ba-kit")).toBe(2);
  });

  it("ignores logs from another booking", () => {
    const out = unitsStillOutBySlice({
      sourced: [{ ...slice, checkedOutQuantity: 10 }],
      siblings: [slice],
      logs: [
        {
          bookingId: "b-2",
          assetId: "pool-1",
          bookingAssetId: null,
          quantity: 6,
        },
      ],
    });
    expect(out.get("ba-1")).toBe(10);
  });
});

describe("loadBookedOutBySource", () => {
  it("sums what is still out per pool and per location it left from", async () => {
    const sourced = [
      {
        ...slice,
        id: "ba-1",
        checkedOutQuantity: 10,
        sourceLocationId: "loc-a",
      },
      {
        ...slice,
        id: "ba-2",
        bookingId: "b-2",
        checkedOutQuantity: 5,
        sourceLocationId: "loc-a",
      },
      {
        ...slice,
        id: "ba-3",
        bookingId: "b-3",
        checkedOutQuantity: 8,
        sourceLocationId: "loc-b",
      },
    ];
    const client = {
      bookingAsset: {
        // The first read is the sourced slices; the second, every slice of
        // those bookings, carries no source.
        findMany: vi.fn((args: { where: { sourceLocationId?: unknown } }) =>
          Promise.resolve(
            args.where.sourceLocationId
              ? sourced
              : sourced.map(({ sourceLocationId: _source, ...row }) => row)
          )
        ),
      },
      consumptionLog: {
        findMany: vi.fn(() =>
          Promise.resolve([
            // 4 of ba-1's 10 came back; ba-3 came back in full.
            {
              bookingId: "b-1",
              assetId: "pool-1",
              bookingAssetId: "ba-1",
              quantity: 4,
            },
            {
              bookingId: "b-3",
              assetId: "pool-1",
              bookingAssetId: "ba-3",
              quantity: 8,
            },
          ])
        ),
      },
    };

    const result = await loadBookedOutBySource(client as never, {
      assetIds: ["pool-1"],
    });

    expect(result.get("pool-1")).toEqual([
      { locationId: "loc-a", quantity: 11 },
    ]);
  });

  it("reads only slices that never came with a kit, so kit residue charges no location", async () => {
    // A kit slice, and a slice whose member left the kit while it was out,
    // both record the kit's location. Neither took units from a manual
    // placement there.
    const findMany = vi.fn(() => Promise.resolve([]));
    const client = {
      bookingAsset: { findMany },
      consumptionLog: { findMany: vi.fn(() => Promise.resolve([])) },
    };

    await loadBookedOutBySource(client as never, { assetIds: ["pool-1"] });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assetKitId: null, sourceKitId: null }),
      })
    );
  });

  it("reads LEGACY groups only: converted groups' units out live on source rows", async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const client = {
      bookingAsset: { findMany },
      consumptionLog: { findMany: vi.fn(() => Promise.resolve([])) },
    };

    await loadBookedOutBySource(client as never, { assetIds: ["pool-1"] });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceAllocation: "LEGACY" }),
      })
    );
  });
});

describe("countUnitsOnBookingsFromLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Converted slices with the status of their booking. */
  const convertedSlices = [
    { id: "ba-on", assetId: "pool-1", status: "ONGOING", mode: "AUTO" },
    { id: "ba-reserved", assetId: "pool-1", status: "RESERVED", mode: "AUTO" },
    { id: "ba-done", assetId: "pool-1", status: "COMPLETE", mode: "MANUAL" },
    { id: "ba-kit", assetId: "pool-1", status: "ONGOING", mode: "KIT" },
  ];

  /** A LEGACY slice out from the location, as the LEGACY read returns it. */
  type LegacySlice = typeof slice & {
    checkedOutQuantity: number;
    sourceLocationId: string;
  };

  /**
   * Seeds the stubs: `sourceRows` answer the source-row read; the slice read
   * applies the `id`, `assetId`, `sourceAllocation` and `booking.status`
   * filters the reader sends. The LEGACY read (it filters on
   * `sourceLocationId`) returns `legacySlices`, and the LEGACY sibling read
   * (it filters on `bookingId`) returns them without their source.
   */
  function seed(
    sourceRows: Array<{ bookingAssetId: string; outQuantity: number }>,
    legacySlices: LegacySlice[] = []
  ) {
    dbMock.bookingAssetSource.findMany.mockResolvedValue(sourceRows);
    dbMock.consumptionLog.findMany.mockResolvedValue([]);
    dbMock.bookingAsset.findMany.mockImplementation(
      (args: {
        where: {
          sourceLocationId?: unknown;
          bookingId?: { in: string[] };
          id?: { in: string[] };
          assetId?: { in: string[] };
          sourceAllocation?: { in: string[] };
          booking?: { status?: { in: string[] } };
        };
      }) => {
        if (args.where.sourceLocationId !== undefined) {
          return Promise.resolve(legacySlices);
        }
        if (args.where.bookingId !== undefined) {
          return Promise.resolve(
            legacySlices.map(({ sourceLocationId: _source, ...row }) => row)
          );
        }
        const { id, assetId, sourceAllocation, booking } = args.where;
        return Promise.resolve(
          convertedSlices
            .filter(
              (s) =>
                (!id || id.in.includes(s.id)) &&
                (!assetId || assetId.in.includes(s.assetId)) &&
                (!sourceAllocation || sourceAllocation.in.includes(s.mode)) &&
                (!booking?.status || booking.status.in.includes(s.status))
            )
            .map(({ id: sliceId, assetId: sliceAsset }) => ({
              id: sliceId,
              assetId: sliceAsset,
            }))
        );
      }
    );
  }

  const args = {
    organizationId: "org-1",
    locationId: "loc-a",
    assetIds: ["pool-1"],
  };

  it("counts a converted LOCATION row out on an ONGOING booking", async () => {
    seed([{ bookingAssetId: "ba-on", outQuantity: 4 }]);

    const counts = await countUnitsOnBookingsFromLocation(args);

    expect(counts.get("pool-1")).toBe(4);
    expect(dbMock.bookingAssetSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          locationId: "loc-a",
          kind: "LOCATION",
          outQuantity: { gt: 0 },
        },
      })
    );
  });

  it("adds LEGACY units out from the location to converted rows out from it", async () => {
    // 2 units out on a LEGACY slice that recorded loc-a, and 3 on a converted
    // LOCATION row at loc-a.
    seed(
      [{ bookingAssetId: "ba-on", outQuantity: 3 }],
      [
        {
          ...slice,
          id: "ba-legacy",
          bookingId: "b-legacy",
          quantity: 2,
          checkedOutQuantity: 2,
          sourceLocationId: "loc-a",
        },
      ]
    );

    const counts = await countUnitsOnBookingsFromLocation(args);

    expect(counts.get("pool-1")).toBe(5);
    expect(dbMock.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceAllocation: "LEGACY",
          sourceLocationId: "loc-a",
        }),
      })
    );
  });

  it("does not count the same row on a RESERVED or COMPLETE booking", async () => {
    seed([
      { bookingAssetId: "ba-reserved", outQuantity: 4 },
      { bookingAssetId: "ba-done", outQuantity: 3 },
    ]);

    const counts = await countUnitsOnBookingsFromLocation(args);

    expect(counts.get("pool-1")).toBeUndefined();
  });

  it("counts only rows whose slice is AUTO or MANUAL", async () => {
    seed([
      { bookingAssetId: "ba-on", outQuantity: 4 },
      { bookingAssetId: "ba-kit", outQuantity: 2 },
    ]);

    const counts = await countUnitsOnBookingsFromLocation(args);

    expect(counts.get("pool-1")).toBe(4);
    expect(dbMock.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceAllocation: { in: ["AUTO", "MANUAL"] },
        }),
      })
    );
  });

  it("issues no converted slice query when no source row is out at the location", async () => {
    seed([]);

    await countUnitsOnBookingsFromLocation(args);

    // Only the LEGACY read touches slices.
    expect(dbMock.bookingAsset.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceAllocation: "LEGACY" }),
      })
    );
  });
});
