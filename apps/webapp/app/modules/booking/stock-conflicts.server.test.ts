/**
 * Unit tests for the bookings-list "Stock conflict" detector
 * (`stock-conflicts.server.ts`).
 *
 * Every test passes its own `StockConflictDbClient`-shaped mock explicitly
 * via `db:` rather than relying on the module-level `~/database/db.server`
 * mock below — that mock exists only so importing the module under test
 * doesn't trigger the real `db.$connect()` side effect (see
 * `apps/webapp/app/database/db.server.ts`), mirroring
 * `availability.server.test.ts`'s convention.
 */
import { describe, expect, it, vitest } from "vitest";

// why: `~/modules/asset/availability.server` imports the real
// `~/database/db.server`, which calls `db.$connect()` at module load time
// outside production. Every test below supplies its own mock client
// explicitly via `db:`, so this stub only exists to keep that side effect
// out of the test run — its contents are never asserted against.
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vitest.fn().mockResolvedValue([]) },
    bookingAsset: { findMany: vitest.fn().mockResolvedValue([]) },
    consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    custody: { groupBy: vitest.fn().mockResolvedValue([]) },
    assetKit: { groupBy: vitest.fn().mockResolvedValue([]) },
  },
}));

// why: `~/modules/asset/availability.server` also imports
// `computeCheckedOutForAsset` from the very large booking service module at
// the top level — that module's own import graph pulls in unrelated
// client-side dependencies that aren't safe to load in this unit test.
// Neither `flagBookingStockConflicts` nor anything it calls touches this
// export (it's only used by the singular `getAssetAvailability`, not the
// batch primitives this module reuses), so an empty stub is sufficient —
// mirrors the identical stub in `availability.server.test.ts`.
vitest.mock("~/modules/booking/service.server", () => ({
  computeCheckedOutForAsset: vitest.fn(),
}));

// why: same rationale as above, for `computeAvailableQuantity` — used only
// by the singular `getAssetAvailability`, not by anything
// `flagBookingStockConflicts` calls.
vitest.mock("~/modules/consumption-log/service.server", () => ({
  computeAvailableQuantity: vitest.fn(),
}));

import {
  flagBookingStockConflicts,
  getStockConflictedBookingIds,
} from "./stock-conflicts.server";
import type {
  BookingForStockConflictCheck,
  BookingForStockConflictLookup,
} from "./stock-conflicts.server";

const ORG_ID = "org1";

/**
 * A `StockConflictDbClient`-shaped mock with empty defaults per method.
 * `custody`/`assetKit` default to `[]` (zero operator-custody, zero
 * kit-allocated units) — the effective-pool threshold then collapses back
 * to raw `total`, which is what most tests below intend unless they
 * override these two explicitly.
 */
function createMockClient() {
  return {
    asset: { findMany: vitest.fn().mockResolvedValue([]) },
    bookingAsset: { findMany: vitest.fn().mockResolvedValue([]) },
    consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    custody: { groupBy: vitest.fn().mockResolvedValue([]) },
    assetKit: { groupBy: vitest.fn().mockResolvedValue([]) },
  };
}

/** Shorthand for a booking-list input row. */
function booking(
  overrides: Partial<BookingForStockConflictCheck> & { id: string }
): BookingForStockConflictCheck {
  return {
    status: "RESERVED",
    from: null,
    to: null,
    qtyAssetIds: [],
    ...overrides,
  };
}

/** Shorthand for an org-wide active standalone `BookingAsset` row. */
function reservedRow(args: {
  assetId: string;
  bookingId: string;
  quantity: number;
  from: string;
  to: string;
  status?: string;
}) {
  return {
    assetId: args.assetId,
    bookingId: args.bookingId,
    quantity: args.quantity,
    booking: {
      from: new Date(args.from),
      to: new Date(args.to),
      status: args.status ?? "RESERVED",
    },
  };
}

describe("flagBookingStockConflicts", () => {
  it("flags BOTH bookings when their overlapping demand exceeds the asset's total", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b2",
        quantity: 6,
        from: "2026-01-05T00:00:00Z",
        to: "2026-01-15T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "b2",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-15T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set(["b1", "b2"]));
  });

  it("flags NEITHER booking once the same two are made non-overlapping", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b2",
        quantity: 6,
        // Shifted to start well after b1 ends — never concurrent, so the
        // naive sum (12) never actually competes for the pool at once.
        from: "2026-01-20T00:00:00Z",
        to: "2026-01-30T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "b2",
          from: new Date("2026-01-20T00:00:00Z"),
          to: new Date("2026-01-30T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set());
  });

  it("flags a booking whose conflict lives on its SECOND asset, not its first", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([
      { id: "a1", quantity: 100 }, // huge pool — a1 is never over-committed
      { id: "a2", quantity: 5 },
    ]);
    client.bookingAsset.findMany.mockResolvedValue([
      // a1: well within its huge total, never conflicts.
      reservedRow({
        assetId: "a1",
        bookingId: "b3",
        quantity: 4,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      // a2: b3 and b4 overlap and together exceed the 5-unit total.
      reservedRow({
        assetId: "a2",
        bookingId: "b3",
        quantity: 4,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a2",
        bookingId: "b4",
        quantity: 4,
        from: "2026-01-03T00:00:00Z",
        to: "2026-01-08T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b3",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1", "a2"],
        }),
      ],
    });

    expect(result.has("b3")).toBe(true);
  });

  it("does not flag a booking whose own window sits outside every over-committed window", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      // b1 + b2 overlap in [Jan5, Jan10) and exceed the 10-unit total there.
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b2",
        quantity: 6,
        from: "2026-01-05T00:00:00Z",
        to: "2026-01-15T00:00:00Z",
      }),
      // b5 also reserves a1, but weeks later and well within capacity on
      // its own — its window never touches the [Jan5,Jan10) over-window.
      reservedRow({
        assetId: "a1",
        bookingId: "b5",
        quantity: 3,
        from: "2026-02-01T00:00:00Z",
        to: "2026-02-05T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "b2",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-15T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "b5",
          from: new Date("2026-02-01T00:00:00Z"),
          to: new Date("2026-02-05T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set(["b1", "b2"]));
    expect(result.has("b5")).toBe(false);
  });

  it("never flags DRAFT or COMPLETE bookings, even if their dates and assets overlap an over-committed window", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b2",
        quantity: 6,
        from: "2026-01-05T00:00:00Z",
        to: "2026-01-15T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "b2",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-15T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        // Same asset, same overlapping dates as b1/b2 — would conflict if
        // eligible, but DRAFT/COMPLETE are never eligible to be flagged.
        booking({
          id: "draft1",
          status: "DRAFT",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-08T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "complete1",
          status: "COMPLETE",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-08T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set(["b1", "b2"]));
    expect(result.has("draft1")).toBe(false);
    expect(result.has("complete1")).toBe(false);
  });

  it("skips a windowless (DRAFT-shaped, no dates) booking without erroring", async () => {
    const client = createMockClient();

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "draft-nodates",
          status: "DRAFT",
          from: null,
          to: null,
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set());
    // Ineligible on both status AND missing dates — no asset id even makes
    // it into the batched queries, so neither should be called at all.
    expect(client.asset.findMany).not.toHaveBeenCalled();
    expect(client.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("issues a constant number of queries regardless of how many bookings/assets are passed (no fan-out)", async () => {
    // why: identical reservation data for both runs (only the input booking
    // list size differs) isolates call COUNT — the thing under test — from
    // data-dependent branching (e.g. the "no reserved rows" skip).
    function buildClient() {
      const client = createMockClient();
      client.asset.findMany.mockResolvedValue([
        { id: "a1", quantity: 10 },
        { id: "a2", quantity: 10 },
        { id: "a3", quantity: 10 },
      ]);
      client.bookingAsset.findMany.mockResolvedValue([
        reservedRow({
          assetId: "a1",
          bookingId: "b1",
          quantity: 2,
          from: "2026-01-01T00:00:00Z",
          to: "2026-01-05T00:00:00Z",
        }),
      ]);
      client.consumptionLog.groupBy.mockResolvedValue([]);
      client.custody.groupBy.mockResolvedValue([]);
      client.assetKit.groupBy.mockResolvedValue([]);
      return client;
    }

    const smallBookings = [
      booking({
        id: "b1",
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-05T00:00:00Z"),
        qtyAssetIds: ["a1"],
      }),
    ];
    const largeBookings = [
      ...smallBookings,
      booking({
        id: "b2",
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-05T00:00:00Z"),
        qtyAssetIds: ["a2"],
      }),
      booking({
        id: "b3",
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-05T00:00:00Z"),
        qtyAssetIds: ["a3"],
      }),
      booking({
        id: "b4",
        status: "ONGOING",
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-05T00:00:00Z"),
        qtyAssetIds: ["a1", "a2", "a3"],
      }),
    ];

    const smallClient = buildClient();
    await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: smallClient,
      bookings: smallBookings,
    });

    const largeClient = buildClient();
    await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: largeClient,
      bookings: largeBookings,
    });

    expect(largeClient.asset.findMany.mock.calls.length).toBe(
      smallClient.asset.findMany.mock.calls.length
    );
    expect(largeClient.bookingAsset.findMany.mock.calls.length).toBe(
      smallClient.bookingAsset.findMany.mock.calls.length
    );
    expect(largeClient.consumptionLog.groupBy.mock.calls.length).toBe(
      smallClient.consumptionLog.groupBy.mock.calls.length
    );
    expect(largeClient.custody.groupBy.mock.calls.length).toBe(
      smallClient.custody.groupBy.mock.calls.length
    );
    expect(largeClient.assetKit.groupBy.mock.calls.length).toBe(
      smallClient.assetKit.groupBy.mock.calls.length
    );

    // Concretely small: exactly one call per delegate regardless of N —
    // including the two new effective-pool queries (custody/inKits), which
    // must NOT fan out per asset either.
    expect(smallClient.asset.findMany.mock.calls.length).toBe(1);
    expect(smallClient.bookingAsset.findMany.mock.calls.length).toBe(1);
    expect(smallClient.consumptionLog.groupBy.mock.calls.length).toBe(1);
    expect(smallClient.custody.groupBy.mock.calls.length).toBe(1);
    expect(smallClient.assetKit.groupBy.mock.calls.length).toBe(1);
  });

  it("subtracts logged dispositions before sweeping, same as the availability primitives", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b2",
        quantity: 6,
        from: "2026-01-05T00:00:00Z",
        to: "2026-01-15T00:00:00Z",
      }),
    ]);
    // b2 already returned 4 of its 6 units — remaining 2, so the genuine
    // concurrent demand in [Jan5,Jan10) is 6(b1) + 2(b2) = 8 ≤ 10 → no
    // conflict once the disposition is subtracted.
    client.consumptionLog.groupBy.mockResolvedValue([
      { bookingId: "b2", assetId: "a1", _sum: { quantity: 4 } },
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
        booking({
          id: "b2",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-15T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set());
  });

  it("treats an OVERDUE booking as occupying every future window (sentinel-extended)", async () => {
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      // Overdue booking's real dates are long past, but with no logged
      // return it still competes for the pool indefinitely.
      reservedRow({
        assetId: "a1",
        bookingId: "od1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-05T00:00:00Z",
        status: "OVERDUE",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b6",
        quantity: 6,
        from: "2026-09-01T00:00:00Z",
        to: "2026-09-05T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b6",
          from: new Date("2026-09-01T00:00:00Z"),
          to: new Date("2026-09-05T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    // 6 (overdue, sentinel-extended) + 6 (b6) = 12 > 10 in September too.
    expect(result).toEqual(new Set(["b6"]));
  });

  /* ------------------------------------------------------------------------ */
  /*         Threshold refinement: effective pool, not raw total             */
  /* ------------------------------------------------------------------------ */

  it(
    "flags a booking whose demand exceeds the EFFECTIVE POOL (total − custody − " +
      "inKits) even though it fits comfortably under raw total — the false-" +
      "negative this refinement closes (row-level red badge already compares " +
      "against bookable, which subtracts the same two figures)",
    async () => {
      const client = createMockClient();
      // total 10, but 4 are in operator custody and 3 are earmarked to a
      // kit — effective pool is only 3. A lone booking of 4 units fits
      // easily under raw total (4 ≤ 10) but exceeds the 3-unit effective
      // pool, so it must be flagged. Under the OLD (total-only) behavior
      // this booking would have been silently missed.
      client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
      client.custody.groupBy.mockResolvedValue([
        { assetId: "a1", _sum: { quantity: 4 } },
      ]);
      client.assetKit.groupBy.mockResolvedValue([
        { assetId: "a1", _sum: { quantity: 3 } },
      ]);
      client.bookingAsset.findMany.mockResolvedValue([
        reservedRow({
          assetId: "a1",
          bookingId: "b7",
          quantity: 4,
          from: "2026-01-01T00:00:00Z",
          to: "2026-01-10T00:00:00Z",
        }),
      ]);

      const result = await flagBookingStockConflicts({
        organizationId: ORG_ID,
        db: client,
        bookings: [
          booking({
            id: "b7",
            from: new Date("2026-01-01T00:00:00Z"),
            to: new Date("2026-01-10T00:00:00Z"),
            qtyAssetIds: ["a1"],
          }),
        ],
      });

      expect(result).toEqual(new Set(["b7"]));
    }
  );

  it("does not flag when demand fits within total AND custody/inKits are both zero — unaffected baseline behavior", async () => {
    const client = createMockClient();
    // Same shape as the very first test in this file, but here explicitly
    // asserting the two new grouped queries themselves (not just relying on
    // the mock default) — a real Postgres query with no custody/kit rows
    // for this asset returns [], collapsing the effective pool back to raw
    // total, so behavior is byte-identical to before this refinement.
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.custody.groupBy.mockResolvedValue([]);
    client.assetKit.groupBy.mockResolvedValue([]);
    client.bookingAsset.findMany.mockResolvedValue([
      reservedRow({
        assetId: "a1",
        bookingId: "b8",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
    ]);

    const result = await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b8",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(result).toEqual(new Set());
  });

  it("scopes the custody (custody.groupBy) and inKits (assetKit.groupBy) queries to the caller's organization", async () => {
    // Mirrors `getAssetAvailabilityBatch`'s identical org-scoping guard in
    // `availability.server.test.ts` — `Custody` has no `organizationId`
    // column of its own, so it must be scoped through the asset relation;
    // `AssetKit` is scoped directly.
    const client = createMockClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    client.bookingAsset.findMany.mockResolvedValue([
      reservedRow({
        assetId: "a1",
        bookingId: "b9",
        quantity: 2,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-05T00:00:00Z",
      }),
    ]);

    await flagBookingStockConflicts({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        booking({
          id: "b9",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
          qtyAssetIds: ["a1"],
        }),
      ],
    });

    expect(client.custody.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: { assetId: { in: ["a1"] }, asset: { organizationId: ORG_ID } },
      _sum: { quantity: true },
    });
    expect(client.assetKit.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: { assetId: { in: ["a1"] }, organizationId: ORG_ID },
      _sum: { quantity: true },
    });
  });
});

/**
 * Tests for the loader-facing wrapper, `getStockConflictedBookingIds`. Unlike
 * `flagBookingStockConflicts` above (which takes `qtyAssetIds` as a given),
 * these tests exercise the extra grouping query this wrapper adds — the
 * bookings-list loaders only have `{id, status, from, to}` per row, no asset
 * ids attached.
 */
describe("getStockConflictedBookingIds", () => {
  /** Shorthand for a bookings-list loader's bare input row. */
  function lookup(
    overrides: Partial<BookingForStockConflictLookup> & { id: string }
  ): BookingForStockConflictLookup {
    return {
      status: "RESERVED",
      from: null,
      to: null,
      ...overrides,
    };
  }

  it("returns an empty set without querying anything when `bookings` is empty", async () => {
    const client = createMockClient();

    const result = await getStockConflictedBookingIds({
      organizationId: ORG_ID,
      db: client,
      bookings: [],
    });

    expect(result).toEqual(new Set());
    expect(client.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("flags a booking whose grouped QT asset is over-committed", async () => {
    const client = createMockClient();
    // First call: this wrapper's own grouping query.
    client.bookingAsset.findMany.mockResolvedValueOnce([
      { bookingId: "b1", assetId: "a1" },
      { bookingId: "b2", assetId: "a1" },
    ]);
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
    // Second call: `flagBookingStockConflicts`'s own (differently-shaped)
    // reserved-rows query, driven by the `qtyAssetIds` this wrapper derived.
    client.bookingAsset.findMany.mockResolvedValueOnce([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a1",
        bookingId: "b2",
        quantity: 6,
        from: "2026-01-05T00:00:00Z",
        to: "2026-01-15T00:00:00Z",
      }),
    ]);

    const result = await getStockConflictedBookingIds({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        lookup({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
        }),
        lookup({
          id: "b2",
          from: new Date("2026-01-05T00:00:00Z"),
          to: new Date("2026-01-15T00:00:00Z"),
        }),
      ],
    });

    expect(result).toEqual(new Set(["b1", "b2"]));
  });

  it("groups MULTIPLE QT assets onto the same booking correctly — a conflict on the second asset still flags it", async () => {
    // Mirrors `flagBookingStockConflicts`'s own "conflict lives on the
    // SECOND asset" test, but here proves the GROUPING step itself: if this
    // wrapper mis-grouped and dropped a2 off booking b1's qtyAssetIds, the
    // booking would never be flagged since a1 alone never conflicts.
    const client = createMockClient();
    client.bookingAsset.findMany.mockResolvedValueOnce([
      { bookingId: "b1", assetId: "a1" },
      { bookingId: "b1", assetId: "a2" },
    ]);
    client.asset.findMany.mockResolvedValue([
      { id: "a1", quantity: 100 }, // huge pool — a1 never conflicts alone
      { id: "a2", quantity: 5 },
    ]);
    client.bookingAsset.findMany.mockResolvedValueOnce([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 4,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a2",
        bookingId: "b1",
        quantity: 4,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
      reservedRow({
        assetId: "a2",
        bookingId: "b3",
        quantity: 4,
        from: "2026-01-03T00:00:00Z",
        to: "2026-01-08T00:00:00Z",
      }),
    ]);

    const result = await getStockConflictedBookingIds({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        lookup({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
        }),
      ],
    });

    expect(result.has("b1")).toBe(true);
  });

  it("never flags a booking that reserves no QUANTITY_TRACKED asset — grouping query returns nothing for it", async () => {
    const client = createMockClient();
    // Only b1 (which has a QT asset) shows up in the grouping result — b2
    // reserves only INDIVIDUAL assets, so the org-scoped query never
    // surfaces it.
    client.bookingAsset.findMany.mockResolvedValueOnce([
      { bookingId: "b1", assetId: "a1" },
    ]);
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 5 }]);
    client.bookingAsset.findMany.mockResolvedValueOnce([
      reservedRow({
        assetId: "a1",
        bookingId: "b1",
        quantity: 6,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      }),
    ]);

    const result = await getStockConflictedBookingIds({
      organizationId: ORG_ID,
      db: client,
      bookings: [
        lookup({
          id: "b1",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
        }),
        lookup({
          id: "b2",
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
        }),
      ],
    });

    expect(result).toEqual(new Set(["b1"]));
    expect(result.has("b2")).toBe(false);
  });

  it("returns an empty set — and never calls the detector's own query — when NO booking has a QT asset", async () => {
    const client = createMockClient();
    client.bookingAsset.findMany.mockResolvedValueOnce([]);

    const result = await getStockConflictedBookingIds({
      organizationId: ORG_ID,
      db: client,
      bookings: [lookup({ id: "b1" }), lookup({ id: "b2", status: "DRAFT" })],
    });

    expect(result).toEqual(new Set());
    // Short-circuited before `flagBookingStockConflicts` would issue its own
    // (second) `bookingAsset.findMany` call.
    expect(client.bookingAsset.findMany).toHaveBeenCalledTimes(1);
    expect(client.asset.findMany).not.toHaveBeenCalled();
  });

  it("scopes the grouping query to standalone (`assetKitId: null`), QUANTITY_TRACKED, org-scoped rows", async () => {
    const client = createMockClient();
    client.bookingAsset.findMany.mockResolvedValueOnce([]);

    await getStockConflictedBookingIds({
      organizationId: ORG_ID,
      db: client,
      bookings: [lookup({ id: "b1" }), lookup({ id: "b2" })],
    });

    expect(client.bookingAsset.findMany).toHaveBeenCalledWith({
      where: {
        bookingId: { in: ["b1", "b2"] },
        assetKitId: null,
        asset: { type: "QUANTITY_TRACKED", organizationId: ORG_ID },
      },
      select: { bookingId: true, assetId: true },
    });
  });
});
