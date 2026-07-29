/**
 * Behavior tests for the canonical booking-pool batch fetcher.
 *
 * Every test asserts OBSERVABLE behavior: either the returned availability
 * rows (arithmetic parity with the pure core) or the flag→where-clause
 * routing (which named variant produces which query filters). No test
 * asserts DB semantics through mock shapes — the mocked Prisma client only
 * verifies that each named flag routes to the documented filter set, which
 * is this module's entire contract (per the design brief: variants are
 * NAMED parameter choices of the same formula, not re-implementations).
 *
 * @see {@link file://./availability.server.ts}
 * @see {@link file://./availability.ts} — pure core (property-tested separately)
 */

import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi, vitest } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  getBookingPoolAvailability,
  getBookingPoolAvailabilityUnscopedForLegacyWrapper,
} from "./availability.server";

// why: the fetcher is a pure query-composition layer over Prisma — we mock
// the client to control each aggregation input and to observe which filters
// each named flag routes into the queries. Defaults model an org with no
// kits/custody/reservations so tests opt in to the state they need.
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    assetKit: {
      groupBy: vitest.fn().mockResolvedValue([]),
    },
    custody: {
      groupBy: vitest.fn().mockResolvedValue([]),
    },
    bookingAsset: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    consumptionLog: {
      groupBy: vitest.fn().mockResolvedValue([]),
    },
  },
}));

const mockedAssetFindMany = vi.mocked(db.asset.findMany);
const mockedAssetKitGroupBy = vi.mocked(db.assetKit.groupBy);
const mockedCustodyGroupBy = vi.mocked(db.custody.groupBy);
const mockedBookingAssetFindMany = vi.mocked(db.bookingAsset.findMany);
const mockedConsumptionLogGroupBy = vi.mocked(db.consumptionLog.groupBy);

/** Baseline args — each test overrides only the flag under test. */
const baseArgs = {
  assetIds: ["asset-1"],
  organizationId: "org-1",
  custodyScope: "all" as const,
};

beforeEach(() => {
  vitest.clearAllMocks();
  // why: clearAllMocks keeps implementations; re-seed the "asset exists"
  // default every test relies on (10 units of stock).
  mockedAssetFindMany.mockResolvedValue([
    { id: "asset-1", quantity: 10 },
  ] as never);
  mockedAssetKitGroupBy.mockResolvedValue([] as never);
  mockedCustodyGroupBy.mockResolvedValue([] as never);
  mockedBookingAssetFindMany.mockResolvedValue([] as never);
  mockedConsumptionLogGroupBy.mockResolvedValue([] as never);
});

describe("getBookingPoolAvailability — arithmetic", () => {
  it("returns full stock with clamped == raw when nothing is committed", async () => {
    const result = await getBookingPoolAvailability(baseArgs);

    expect(result.get("asset-1")).toEqual({
      total: 10,
      inKits: 0,
      inCustody: 0,
      reserved: 0,
      checkedOut: 0,
      raw: 10,
      available: 10,
    });
  });

  it("splits reserved vs checkedOut by booking status and subtracts both", async () => {
    mockedCustodyGroupBy.mockResolvedValue([
      { assetId: "asset-1", _sum: { quantity: 2 } },
    ] as never);
    mockedBookingAssetFindMany.mockResolvedValue([
      {
        assetId: "asset-1",
        bookingId: "b-1",
        quantity: 3,
        booking: { status: BookingStatus.RESERVED },
      },
      {
        assetId: "asset-1",
        bookingId: "b-2",
        quantity: 4,
        booking: { status: BookingStatus.ONGOING },
      },
    ] as never);

    const result = await getBookingPoolAvailability(baseArgs);

    // 10 − 2 custody − 3 reserved − 4 checked-out = 1
    expect(result.get("asset-1")).toMatchObject({
      inCustody: 2,
      reserved: 3,
      checkedOut: 4,
      raw: 1,
      available: 1,
    });
  });

  it("reports oversubscription as a negative raw with available clamped to 0 (never lies, never shows a negative)", async () => {
    mockedBookingAssetFindMany.mockResolvedValue([
      {
        assetId: "asset-1",
        bookingId: "b-1",
        quantity: 17,
        booking: { status: BookingStatus.RESERVED },
      },
    ] as never);

    const result = await getBookingPoolAvailability(baseArgs);

    expect(result.get("asset-1")).toMatchObject({ raw: -7, available: 0 });
  });

  it("dedupes repeated asset ids into a single result row", async () => {
    const result = await getBookingPoolAvailability({
      ...baseArgs,
      assetIds: ["asset-1", "asset-1", "asset-1"],
    });

    expect(result.size).toBe(1);
    const queriedIds = mockedAssetFindMany.mock.calls[0][0]?.where?.id as {
      in: string[];
    };
    expect(queriedIds.in).toEqual(["asset-1"]);
  });

  it("returns an empty map without querying when assetIds is empty", async () => {
    const result = await getBookingPoolAvailability({
      ...baseArgs,
      assetIds: [],
    });

    expect(result.size).toBe(0);
    expect(mockedAssetFindMany).not.toHaveBeenCalled();
  });

  it("wraps unexpected query failures in a ShelfError", async () => {
    mockedAssetFindMany.mockRejectedValue(new Error("connection reset"));

    await expect(getBookingPoolAvailability(baseArgs)).rejects.toBeInstanceOf(
      ShelfError
    );
  });
});

describe("getBookingPoolAvailability — org scoping (cross-org IDOR guard)", () => {
  it("org-scopes the asset lookup and omits foreign-org ids from the result AND from downstream queries", async () => {
    // asset-foreign does not survive the org-scoped lookup.
    mockedAssetFindMany.mockResolvedValue([
      { id: "asset-1", quantity: 10 },
    ] as never);

    const result = await getBookingPoolAvailability({
      ...baseArgs,
      assetIds: ["asset-1", "asset-foreign"],
    });

    expect(mockedAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1" }),
      })
    );
    // Foreign id: absent from the map (callers treat missing as not-found)…
    expect(result.has("asset-foreign")).toBe(false);
    // …and never forwarded to the reservation aggregation.
    const bookingWhere = mockedBookingAssetFindMany.mock.calls[0][0]?.where;
    expect(bookingWhere?.assetId).toEqual({ in: ["asset-1"] });
  });

  it("confines the unscoped (null-org) read to the legacy wrapper entry point", async () => {
    // The scoped export requires `organizationId: string` at compile time;
    // only the legacy-wrapper export may skip the org filter (its callers
    // org-validate upstream — see the entry point's JSDoc).
    await getBookingPoolAvailabilityUnscopedForLegacyWrapper({
      ...baseArgs,
      organizationId: null,
    });

    expect(mockedAssetFindMany.mock.calls[0][0]?.where).not.toHaveProperty(
      "organizationId"
    );
  });
});

describe("getBookingPoolAvailability — named flag routing", () => {
  it("custodyScope 'operator' counts only asset-level custody rows (kitCustodyId null); 'all' counts every row", async () => {
    await getBookingPoolAvailability({ ...baseArgs, custodyScope: "operator" });
    expect(mockedCustodyGroupBy.mock.calls[0][0]?.where).toMatchObject({
      kitCustodyId: null,
    });

    vitest.clearAllMocks();
    mockedAssetFindMany.mockResolvedValue([
      { id: "asset-1", quantity: 10 },
    ] as never);
    mockedCustodyGroupBy.mockResolvedValue([] as never);
    mockedBookingAssetFindMany.mockResolvedValue([] as never);

    await getBookingPoolAvailability({ ...baseArgs, custodyScope: "all" });
    expect(mockedCustodyGroupBy.mock.calls[0][0]?.where).not.toHaveProperty(
      "kitCustodyId"
    );
  });

  it("includeKitSlices=true subtracts kit-earmarked units; false skips the kit query entirely", async () => {
    mockedAssetKitGroupBy.mockResolvedValue([
      { assetId: "asset-1", _sum: { quantity: 4 } },
    ] as never);

    const withKits = await getBookingPoolAvailability({
      ...baseArgs,
      includeKitSlices: true,
    });
    expect(withKits.get("asset-1")).toMatchObject({
      inKits: 4,
      raw: 6,
      available: 6,
    });

    vitest.clearAllMocks();
    mockedAssetFindMany.mockResolvedValue([
      { id: "asset-1", quantity: 10 },
    ] as never);
    mockedCustodyGroupBy.mockResolvedValue([] as never);
    mockedBookingAssetFindMany.mockResolvedValue([] as never);

    const withoutKits = await getBookingPoolAvailability({
      ...baseArgs,
      includeKitSlices: false,
    });
    expect(mockedAssetKitGroupBy).not.toHaveBeenCalled();
    expect(withoutKits.get("asset-1")).toMatchObject({ inKits: 0, raw: 10 });
  });

  it("excludeBookingId removes the current booking's own reservation from the count", async () => {
    await getBookingPoolAvailability({
      ...baseArgs,
      excludeBookingId: "booking-current",
    });

    expect(mockedBookingAssetFindMany.mock.calls[0][0]?.where).toMatchObject({
      bookingId: { not: "booking-current" },
    });
  });

  it("window scopes competing reservations to date-overlapping bookings; null keeps the pool global (#2724 divergence, named not resolved)", async () => {
    const window = {
      from: new Date("2026-08-01T09:00:00Z"),
      to: new Date("2026-08-03T17:00:00Z"),
    };
    await getBookingPoolAvailability({ ...baseArgs, window });

    const windowedWhere = mockedBookingAssetFindMany.mock.calls[0][0]?.where
      ?.booking as Record<string, unknown>;
    // Overlap filter verbatim from the pre-migration picker formulas.
    expect(windowedWhere.OR).toEqual([
      { from: { lte: window.to }, to: { gte: window.from } },
      { from: { gte: window.from }, to: { lte: window.to } },
    ]);

    vitest.clearAllMocks();
    mockedAssetFindMany.mockResolvedValue([
      { id: "asset-1", quantity: 10 },
    ] as never);
    mockedCustodyGroupBy.mockResolvedValue([] as never);
    mockedBookingAssetFindMany.mockResolvedValue([] as never);

    await getBookingPoolAvailability({ ...baseArgs, window: null });
    const globalWhere = mockedBookingAssetFindMany.mock.calls[0][0]?.where
      ?.booking as Record<string, unknown>;
    expect(globalWhere.OR).toBeUndefined();
  });

  it("only RESERVED/ONGOING/OVERDUE reservations consume headroom (fixed active-status set)", async () => {
    await getBookingPoolAvailability(baseArgs);

    const bookingWhere = mockedBookingAssetFindMany.mock.calls[0][0]?.where
      ?.booking as { status: { in: string[] } };
    expect(bookingWhere.status.in).toEqual([
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ]);
  });
});

describe("getBookingPoolAvailability — dispositionAware", () => {
  it("true (default): subtracts logged terminal dispositions per slice, clamped at 0 per slice", async () => {
    mockedBookingAssetFindMany.mockResolvedValue([
      // b-1 booked 5, logged 7 → over-logged slice clamps to 0 (never negative).
      {
        assetId: "asset-1",
        bookingId: "b-1",
        quantity: 5,
        booking: { status: BookingStatus.RESERVED },
      },
      // b-2 booked 4, logged 1 → 3 effective.
      {
        assetId: "asset-1",
        bookingId: "b-2",
        quantity: 4,
        booking: { status: BookingStatus.RESERVED },
      },
    ] as never);
    mockedConsumptionLogGroupBy.mockResolvedValue([
      { bookingId: "b-1", assetId: "asset-1", _sum: { quantity: 7 } },
      { bookingId: "b-2", assetId: "asset-1", _sum: { quantity: 1 } },
    ] as never);

    const result = await getBookingPoolAvailability(baseArgs);

    // reserved = max(0, 5−7) + max(0, 4−1) = 0 + 3
    expect(result.get("asset-1")).toMatchObject({
      reserved: 3,
      raw: 7,
      available: 7,
    });
    // Only terminal dispositions shrink a reservation — CHECKOUT is a
    // handoff into custody, not a reservation change.
    const logWhere = mockedConsumptionLogGroupBy.mock.calls[0][0]?.where as {
      category: { in: string[] };
    };
    expect(logWhere.category.in).toEqual([
      "RETURN",
      "CONSUME",
      "LOSS",
      "DAMAGE",
    ]);
  });

  it("false: reproduces the raw booked-sum (pre-migration picker behavior) and never queries ConsumptionLog", async () => {
    mockedBookingAssetFindMany.mockResolvedValue([
      {
        assetId: "asset-1",
        bookingId: "b-1",
        quantity: 5,
        booking: { status: BookingStatus.RESERVED },
      },
    ] as never);
    // Even if logs exist, dispositionAware:false must not read them.
    mockedConsumptionLogGroupBy.mockResolvedValue([
      { bookingId: "b-1", assetId: "asset-1", _sum: { quantity: 5 } },
    ] as never);

    const result = await getBookingPoolAvailability({
      ...baseArgs,
      dispositionAware: false,
    });

    expect(mockedConsumptionLogGroupBy).not.toHaveBeenCalled();
    expect(result.get("asset-1")).toMatchObject({ reserved: 5, raw: 5 });
  });

  it("variants agree on sign: for the same inputs, every flag combination satisfies available === max(0, raw)", async () => {
    // The cross-variant clamp property, exercised through the fetcher: an
    // oversubscribed pool must clamp identically whichever variant reads it.
    mockedBookingAssetFindMany.mockResolvedValue([
      {
        assetId: "asset-1",
        bookingId: "b-1",
        quantity: 25,
        booking: { status: BookingStatus.OVERDUE },
      },
    ] as never);

    for (const dispositionAware of [true, false]) {
      for (const includeKitSlices of [true, false]) {
        for (const custodyScope of ["operator", "all"] as const) {
          const result = await getBookingPoolAvailability({
            ...baseArgs,
            dispositionAware,
            includeKitSlices,
            custodyScope,
          });
          const row = result.get("asset-1");
          expect(row).toBeDefined();
          expect(row!.available).toBe(Math.max(0, row!.raw));
          expect(row!.raw).toBeLessThan(0);
        }
      }
    }
  });
});
