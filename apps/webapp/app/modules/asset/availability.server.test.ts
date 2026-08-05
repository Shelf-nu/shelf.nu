/**
 * Unit tests for the asset availability primitive (`availability.server.ts`).
 *
 * Phase 1 (Foundation) covers four pieces, tested in dependency order:
 *   1. `peakConcurrent` — pure interval sweep, no mocks needed.
 *   2. `getAssetAvailability` — windowed primitive; mocks the db client.
 *   3. `buildInsufficientStockMessage` — pure string builder.
 *   4. `assertAssetQuantityAvailable` — directional write guard.
 *
 * Mock shape mirrors `apps/webapp/app/modules/booking-model-request/service.server.test.ts`
 * (inline `db` mock with `$transaction` routing the callback through the same
 * mock, plus per-method `mockResolvedValue` overrides per test).
 */
import { describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

// why: getAssetAvailability composes `computeAvailableQuantity` (custody-based
// total/inCustody) with its own kit/reservation queries. That collaborator has
// its own test coverage in consumption-log/service.server.test.ts, so we stub
// it here to isolate the composition logic under test (which fields it reads
// and how it combines them) from custody-aggregation internals.
const computeAvailableQuantityMock = vitest.fn();
vitest.mock("~/modules/consumption-log/service.server", () => ({
  computeAvailableQuantity: (...args: unknown[]) =>
    computeAvailableQuantityMock(...args),
}));

// why: computeCheckedOutBreakdownForAsset lives in the very large booking
// service module and has its own dedicated test coverage there (Wave-B partial
// checkout attribution + the #2790 ③ standalone/kit split). Stubbing it keeps
// this test file focused on how getAssetAvailability *uses* the checked-out
// breakdown (`total` for display, `standalone` for `physicalAvailable`), not
// how it's derived. It returns `{ total, standalone }` — the split the
// availability primitive consumes.
const computeCheckedOutBreakdownForAssetMock = vitest.fn();
vitest.mock("~/modules/booking/service.server", () => ({
  computeCheckedOutBreakdownForAsset: (...args: unknown[]) =>
    computeCheckedOutBreakdownForAssetMock(...args),
}));

vitest.mock("~/database/db.server", () => ({
  db: {
    assetKit: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    bookingAsset: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    consumptionLog: {
      groupBy: vitest.fn().mockResolvedValue([]),
    },
  },
}));

// why: `vitest.mock` calls above are hoisted above all imports by Vitest's
// transform regardless of source position, so importing the module under
// test here (after the mocks are declared) is only for readability.
import {
  assertAssetQuantitiesAvailable,
  assertAssetQuantityAvailable,
  assertAssetQuantityNotBelowReservations,
  buildInsufficientStockMessage,
  getAssetAvailability,
  getAssetAvailabilityBatch,
  overCommittedWindows,
  peakConcurrent,
} from "./availability.server";
const iv = (from: string, to: string, qty: number) => ({
  from: new Date(from),
  to: new Date(to),
  qty,
});

/**
 * A fresh, standalone `PrismaClientOrTx`-shaped mock — deliberately a
 * DIFFERENT object from the globally-mocked `db` above. `assertAssetQuantityAvailable`
 * must thread its caller-supplied `tx` into `getAssetAvailability`'s
 * reserved-quantity read (that's the whole point of accepting `tx`: the read
 * has to run inside the caller's transaction, behind
 * `lockAssetForQuantityUpdate`, so the check and the write are race-safe).
 * If `mockTx` were the same object as `db`, a regression where the guard
 * silently fell back to the untransacted global `db` would be invisible to
 * these tests — they'd still pass because both names point at the same
 * mock. Keeping them distinct lets us assert the reserved read actually ran
 * on `mockTx.bookingAsset.findMany`, not `db.bookingAsset.findMany`.
 *
 * Deliberately NOT annotated with an explicit `PrismaClientOrTx` return
 * type: leaving it inferred keeps each method typed as a full Vitest `Mock`
 * (so `.mockResolvedValue(...)` is callable in tests without a cast), while
 * structural assignability still verifies it satisfies `PrismaClientOrTx`
 * wherever a test passes it as `tx:`.
 */
function createMockTx() {
  return {
    assetKit: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    bookingAsset: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    consumptionLog: {
      groupBy: vitest.fn().mockResolvedValue([]),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                               peakConcurrent                               */
/* -------------------------------------------------------------------------- */

describe("peakConcurrent", () => {
  it("returns 0 for no intervals", () => {
    expect(peakConcurrent([])).toBe(0);
  });

  it("does not stack non-overlapping intervals (the bb1/bb2 bug)", () => {
    // bb1 ends 15:00 Jul29, bb2 starts 08:58 Jul30 — never concurrent
    expect(
      peakConcurrent([
        iv("2026-07-28T08:56:00Z", "2026-07-29T15:00:00Z", 7),
        iv("2026-07-30T08:58:00Z", "2026-08-01T15:00:00Z", 7),
      ])
    ).toBe(7);
  });

  it("sums genuinely concurrent intervals", () => {
    expect(
      peakConcurrent([
        iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 6),
        iv("2026-01-05T00:00:00Z", "2026-01-15T00:00:00Z", 5),
      ])
    ).toBe(11);
  });

  it("finds the peak of a chained set spanning a long window", () => {
    // A and B never overlap each other; C overlaps both in turn but singly
    expect(
      peakConcurrent([
        iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 5),
        iv("2026-01-20T00:00:00Z", "2026-01-31T00:00:00Z", 6),
        iv("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z", 3),
      ])
    ).toBe(9); // max is C(3)+B(6) = 9
  });

  it("treats touching boundaries (end == next start) as non-overlapping", () => {
    expect(
      peakConcurrent([
        iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 4),
        iv("2026-01-10T00:00:00Z", "2026-01-20T00:00:00Z", 4),
      ])
    ).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/*                           overCommittedWindows                             */
/* -------------------------------------------------------------------------- */

describe("overCommittedWindows", () => {
  it("returns no windows for empty input", () => {
    expect(overCommittedWindows([], 5)).toEqual([]);
  });

  it("returns no windows when a single interval is at-or-under total", () => {
    expect(
      overCommittedWindows(
        [iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 5)],
        5
      )
    ).toEqual([]);
    expect(
      overCommittedWindows(
        [iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 3)],
        5
      )
    ).toEqual([]);
  });

  it("returns no windows when the concurrent sum is EXACTLY total (strict >)", () => {
    // Two overlapping intervals summing to exactly 10 — "at capacity", not
    // over-committed. `overCommittedWindows` must use a STRICT `>` so this
    // never fires (unlike a naive `>=` that would over-flag every
    // fully-booked asset).
    expect(
      overCommittedWindows(
        [
          iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 6),
          iv("2026-01-05T00:00:00Z", "2026-01-15T00:00:00Z", 4),
        ],
        10
      )
    ).toEqual([]);
  });

  it("returns the exact window for a genuine over-commit", () => {
    // A(0-10, 6) + B(5-15, 6) → concurrent sum 12 > total 10 only during the
    // genuine overlap [5,10) — before/after that only one interval is live
    // (6 ≤ 10).
    const windows = overCommittedWindows(
      [
        iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 6),
        iv("2026-01-05T00:00:00Z", "2026-01-15T00:00:00Z", 6),
      ],
      10
    );
    expect(windows).toEqual([
      {
        from: new Date("2026-01-05T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
    ]);
  });

  it("finds every over-committed window in a chained/nested set spanning a long timeline", () => {
    // A and B never overlap each other; C overlaps both in turn.
    // [Jan1,Jan10): A(5)+C(3)=8 > total(7). [Jan10,Jan20): C(3) alone ≤ 7.
    // [Jan20,Jan31): B(6)+C(3)=9 > total(7).
    const windows = overCommittedWindows(
      [
        iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 5), // A
        iv("2026-01-20T00:00:00Z", "2026-01-31T00:00:00Z", 6), // B
        iv("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z", 3), // C
      ],
      7
    );
    expect(windows).toEqual([
      {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
      {
        from: new Date("2026-01-20T00:00:00Z"),
        to: new Date("2026-01-31T00:00:00Z"),
      },
    ]);
  });

  it("does not flag two intervals as overlapping merely because they touch (each individually ≤ total)", () => {
    // A(0-10,6) and B(10-20,6) never overlap — end-exclusive boundaries mean
    // the level is 6 throughout, never both at once. total 10 → never over.
    expect(
      overCommittedWindows(
        [
          iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 6),
          iv("2026-01-10T00:00:00Z", "2026-01-20T00:00:00Z", 6),
        ],
        10
      )
    ).toEqual([]);
  });

  it("merges back-to-back over-committed intervals that touch into ONE continuous window", () => {
    // A(0-10,6) and B(10-20,6) each individually exceed total(5) — the level
    // never dips to ≤5 at the touching boundary, so the two spans merge into
    // one continuous over-committed window [Jan1,Jan20) rather than two
    // separate windows or a false gap at the boundary.
    const windows = overCommittedWindows(
      [
        iv("2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 6),
        iv("2026-01-10T00:00:00Z", "2026-01-20T00:00:00Z", 6),
      ],
      5
    );
    expect(windows).toEqual([
      {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-20T00:00:00Z"),
      },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*                            getAssetAvailability                            */
/* -------------------------------------------------------------------------- */

describe("getAssetAvailability", () => {
  const ASSET_ID = "asset1";
  const ORG_ID = "org1";

  function resetMocks() {
    vitest.clearAllMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 10, inCustody: 0 });
    computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
      total: 0,
      standalone: 0,
    });
    // @ts-expect-error mocked
    db.assetKit.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([]);
    // @ts-expect-error mocked
    db.consumptionLog.groupBy.mockResolvedValue([]);
  }

  it("does not go negative for non-overlapping reservations (bb1/bb2)", async () => {
    resetMocks();
    // total 10, custody 0, kits 0, checkedOut 0;
    // two standalone RESERVED rows of 7 in non-overlapping windows
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "bb1",
        quantity: 7,
        booking: {
          from: new Date("2026-07-28T08:56:00Z"),
          to: new Date("2026-07-29T15:00:00Z"),
          status: "RESERVED",
        },
      },
      {
        bookingId: "bb2",
        quantity: 7,
        booking: {
          from: new Date("2026-07-30T08:58:00Z"),
          to: new Date("2026-08-01T15:00:00Z"),
          status: "RESERVED",
        },
      },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-07-28T00:00:00Z"),
        to: new Date("2026-08-01T15:00:00Z"),
      },
    });

    expect(a.reserved).toBe(7); // peak, not 14
    expect(a.bookable).toBe(3);
    expect(a.physicalAvailable).toBe(10);
    expect(a.reservedTotal).toBe(14);
    expect(a.reservingBookingCount).toBe(2);
  });

  it("excludes kit-driven rows from reserved (no double count)", async () => {
    resetMocks();
    // inKits 3 (one AssetKit membership of qty 3). The findMany mock stands
    // in for what a real query already filtered via `assetKitId: null` — only
    // the standalone row (qty 2) comes back; the kit-driven row never reaches
    // the reserved sum because it isn't part of this result set.
    // @ts-expect-error mocked
    db.assetKit.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "b1",
        quantity: 2,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
        },
      },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
    });

    expect(a.inKits).toBe(3);
    expect(a.reserved).toBe(2); // kit-driven row NOT summed again

    // The query itself must ask Prisma to exclude kit-driven rows —
    // verifying the where-clause is what actually protects us in
    // production (the mock return value alone doesn't prove the filter).
    const call = (
      db.bookingAsset.findMany as unknown as {
        mock: { calls: Array<[{ where?: { assetKitId?: unknown } }]> };
      }
    ).mock.calls[0];
    expect(call?.[0]?.where?.assetKitId).toBeNull();
  });

  it("subtracts checked-out regardless of window (OVERDUE trap)", async () => {
    resetMocks();
    // checkedOut 4 from an OVERDUE booking whose window is in the past —
    // the requested window below is in the future, proving checkedOut is
    // window-independent.
    computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
      total: 4,
      standalone: 4,
    });

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-09-01T00:00:00Z"),
        to: new Date("2026-09-05T00:00:00Z"),
      },
    });

    expect(a.checkedOut).toBe(4);
    expect(a.physicalAvailable).toBe(6);
  });

  it("excludes the current booking from the reserved query", async () => {
    resetMocks();

    await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      excludeBookingId: "bookingSelf",
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
    });

    const call = (
      db.bookingAsset.findMany as unknown as {
        mock: { calls: Array<[{ where?: { bookingId?: unknown } }]> };
      }
    ).mock.calls[0];
    expect(call?.[0]?.where?.bookingId).toEqual({ not: "bookingSelf" });
  });

  it("scopes the inKits (assetKit.aggregate) query to the caller's organization", async () => {
    resetMocks();

    await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
    });

    // Mirrors the org-scope style of the `bookingAsset.findMany` where-clause
    // assertions above: `inKits` must never aggregate another workspace's
    // `AssetKit` rows for the same `assetId`.
    expect(db.assetKit.aggregate).toHaveBeenCalledWith({
      where: { assetId: ASSET_ID, organizationId: ORG_ID },
      _sum: { quantity: true },
    });
  });

  it("subtracts logged dispositions (RETURN/CONSUME/LOSS/DAMAGE) per booking", async () => {
    resetMocks();
    // Booked 5, but 2 already returned via partial check-in — remaining 3.
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "b1",
        quantity: 5,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
          status: "RESERVED",
        },
      },
    ]);
    // @ts-expect-error mocked
    db.consumptionLog.groupBy.mockResolvedValue([
      { bookingId: "b1", _sum: { quantity: 2 } },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
    });

    expect(a.reserved).toBe(3);
    expect(a.reservedTotal).toBe(3);
  });

  it("clamps a row at 0 when logged dispositions exceed the booked quantity", async () => {
    resetMocks();
    // Defence-in-depth: an over-logged booking (should not happen) must not
    // push `reserved` negative and silently inflate bookable.
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "b1",
        quantity: 2,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
        },
      },
    ]);
    // @ts-expect-error mocked
    db.consumptionLog.groupBy.mockResolvedValue([
      { bookingId: "b1", _sum: { quantity: 5 } },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
    });

    expect(a.reserved).toBe(0);
    expect(a.reservedTotal).toBe(0);
    expect(a.reservingBookingCount).toBe(0);
  });

  it("reports the plain informational total (not peak) when no window is given", async () => {
    resetMocks();
    // Two rows that would peak at 7 if windowed — without a window we sum
    // the plain remaining totals instead (informational reading).
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "bb1",
        quantity: 7,
        booking: {
          from: new Date("2026-07-28T08:56:00Z"),
          to: new Date("2026-07-29T15:00:00Z"),
          status: "RESERVED",
        },
      },
      {
        bookingId: "bb2",
        quantity: 7,
        booking: {
          from: new Date("2026-07-30T08:58:00Z"),
          to: new Date("2026-08-01T15:00:00Z"),
          status: "RESERVED",
        },
      },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
    });

    expect(a.reserved).toBe(14);
    expect(a.reservedTotal).toBe(14);
  });

  it("computes a signed (possibly negative) bookable — never clamps at the primitive", async () => {
    resetMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 5, inCustody: 0 });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "b1",
        quantity: 8,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
        },
      },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-10T00:00:00Z"),
      },
    });

    expect(a.bookable).toBe(-3);
  });

  /* ------------------------------------------------------------------------ */
  /*         Windowed-occupancy model regressions (the "bb1/bb2" fix)         */
  /* ------------------------------------------------------------------------ */

  it(
    "(a1) an ONGOING booking ending before a non-overlapping FUTURE window " +
      "does NOT reduce that window's bookable (the real bb1/bb2 bug)",
    async () => {
      resetMocks();
      // bb1: ONGOING, 7 units checked out, window Jul27–29 (already returning
      // before bb2 even starts). checkedOut mirrors bb1's units being
      // physically off the shelf right now.
      computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
        total: 7,
        standalone: 7,
      });
      // A real Postgres query for bb2's OWN window (Jul30–Aug1) — with the
      // new `booking.OR: [{status: OVERDUE}, {dateOverlap}]` filter — would
      // exclude bb1 entirely: it's ONGOING (not OVERDUE) and its dates don't
      // overlap Jul30–Aug1. The mock models that already-filtered result.
      // @ts-expect-error mocked
      db.bookingAsset.findMany.mockResolvedValue([]);

      const a = await getAssetAvailability({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        window: {
          from: new Date("2026-07-30T08:58:00Z"),
          to: new Date("2026-08-01T15:00:00Z"),
        },
      });

      // Old model: bookable = physicalAvailable(3) - reserved(0) = 3 →
      // bb2 requesting 7 units would have hard-failed "Insufficient stock"
      // even though bb1 is back on the shelf well before bb2 starts. New
      // model: bookable = total - inCustody - inKits - reserved = 10-0-0-0.
      expect(a.reserved).toBe(0);
      expect(a.bookable).toBe(10);
      // The physical-now headline is unaffected — bb1's 7 units are still
      // genuinely off the shelf RIGHT NOW, independent of any future window.
      expect(a.checkedOut).toBe(7);
      expect(a.physicalAvailable).toBe(3);

      // Structural proof the query itself asks Postgres to exclude a
      // non-overlapping ONGOING booking while always including OVERDUE ones
      // — the mock's canned [] above only proves the code COMPILES with an
      // empty result, not that it asked for the right filter.
      const call = (
        db.bookingAsset.findMany as unknown as {
          mock: {
            calls: Array<[{ where?: { booking?: { OR?: unknown } } }]>;
          };
        }
      ).mock.calls[0];
      expect(call?.[0]?.where?.booking?.OR).toEqual([
        { status: "OVERDUE" },
        {
          // STRICT half-open overlap (end-exclusive, matches peakConcurrent).
          AND: [
            { from: { lt: new Date("2026-08-01T15:00:00Z") } },
            { to: { gt: new Date("2026-07-30T08:58:00Z") } },
          ],
        },
      ]);
    }
  );

  it(
    "(a2) reservedTotal (windowless) excludes the checked-out portion — " +
      "the asset-overview double-count bug",
    async () => {
      resetMocks();
      // Same bb1 (ONGOING, checked out 7) + bb2 (RESERVED, 7) fixture as the
      // background report, but called WITHOUT a window (informational mode,
      // as the asset-overview loader does) — both active rows are returned
      // regardless of date.
      computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
        total: 7,
        standalone: 7,
      });
      // @ts-expect-error mocked
      db.bookingAsset.findMany.mockResolvedValue([
        {
          bookingId: "bb1",
          quantity: 7,
          booking: {
            from: new Date("2026-07-27T08:56:00Z"),
            to: new Date("2026-07-29T15:00:00Z"),
            status: "ONGOING",
          },
        },
        {
          bookingId: "bb2",
          quantity: 7,
          booking: {
            from: new Date("2026-07-30T08:58:00Z"),
            to: new Date("2026-08-01T15:00:00Z"),
            status: "RESERVED",
          },
        },
      ]);

      const a = await getAssetAvailability({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
      });

      // Old model: reservedTotal was the raw sum (14) — bb1's 7 units counted
      // in BOTH "Checked out" (7) AND "Reserved" (14). New model: the
      // informational "Reserved (bookings)" counts UPCOMING (RESERVED) bookings
      // only, so only bb2's still-just-reserved 7 units show up here — disjoint
      // from the "Checked out 7" headline.
      expect(a.reservedTotal).toBe(7);
      // Windowless `reserved` (drives a dateless `bookable`) stays CONSERVATIVE:
      // every active commitment, incl. bb1's checked-out units → 14.
      expect(a.reserved).toBe(14);
      expect(a.checkedOut).toBe(7);
      // Only bb2 is upcoming (RESERVED); bb1 is ONGOING/checked-out, so the
      // tooltip correctly says "1 upcoming booking", not 2 (the reported bug).
      expect(a.reservingBookingCount).toBe(1);
    }
  );

  it("(b) an OVERDUE booking occupies a FUTURE window (sentinel-extended interval)", async () => {
    resetMocks();
    // Overdue booking's own window already elapsed (early July); the target
    // window is two months later. Since there's no known return date, the
    // sentinel-extended interval must still occupy it.
    computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
      total: 4,
      standalone: 4,
    });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "od1",
        quantity: 4,
        booking: {
          from: new Date("2026-07-01T00:00:00Z"),
          to: new Date("2026-07-10T00:00:00Z"),
          status: "OVERDUE",
        },
      },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-09-01T00:00:00Z"),
        to: new Date("2026-09-05T00:00:00Z"),
      },
    });

    // The OVERDUE row's real `to` (Jul10) is nowhere near September — only
    // the sentinel `to` makes it occupy this future window at all.
    expect(a.reserved).toBe(4);
    expect(a.bookable).toBe(6); // 10 - 0 - 0 - 4(reserved)
    expect(a.checkedOut).toBe(4);
    expect(a.physicalAvailable).toBe(6); // 10 - 0 - 0 - 4(checkedOut)
  });

  it("(c) a window genuinely overlapping an ONGOING booking still counts it", async () => {
    resetMocks();
    computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
      total: 5,
      standalone: 5,
    });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "ong1",
        quantity: 5,
        booking: {
          from: new Date("2026-08-01T00:00:00Z"),
          to: new Date("2026-08-10T00:00:00Z"),
          status: "ONGOING",
        },
      },
    ]);

    const a = await getAssetAvailability({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      window: {
        from: new Date("2026-08-05T00:00:00Z"),
        to: new Date("2026-08-15T00:00:00Z"),
      },
    });

    // The window (Aug5–15) genuinely overlaps the ONGOING booking's real
    // dates (Aug1–10) — its REAL `to` (not a sentinel) still reduces this
    // window's bookable, unlike the non-overlapping case in (a1).
    expect(a.reserved).toBe(5);
    expect(a.bookable).toBe(5); // 10 - 0 - 0 - 5(reserved)
  });
});

/* -------------------------------------------------------------------------- */
/*                         getAssetAvailabilityBatch                          */
/* -------------------------------------------------------------------------- */

describe("getAssetAvailabilityBatch", () => {
  const ORG_ID = "org1";

  /**
   * A `AvailabilityBatchClient`-shaped mock, independent from the
   * module-level `db` mock used by the `getAssetAvailability` tests above —
   * the batch primitive's delegate methods (`asset.findMany`,
   * `custody.groupBy`, `assetKit.groupBy`, `partialBookingCheckout.findMany`,
   * the two-key `consumptionLog.groupBy`) don't exist on that mock's shape,
   * so reusing it would require bolting unrelated fields onto an already
   * shared object. Every method defaults to an empty resolved value so a
   * test only needs to override what it cares about.
   */
  function createMockBatchClient() {
    return {
      asset: { findMany: vitest.fn().mockResolvedValue([]) },
      custody: { groupBy: vitest.fn().mockResolvedValue([]) },
      assetKit: { groupBy: vitest.fn().mockResolvedValue([]) },
      bookingAsset: { findMany: vitest.fn().mockResolvedValue([]) },
      partialBookingCheckout: { findMany: vitest.fn().mockResolvedValue([]) },
      consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    };
  }

  /** Resets the module-level `db` mock used by the singular primitive tests. */
  function resetSingularMocks() {
    vitest.clearAllMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 10, inCustody: 0 });
    computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
      total: 0,
      standalone: 0,
    });
    // @ts-expect-error mocked
    db.assetKit.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([]);
    // @ts-expect-error mocked
    db.consumptionLog.groupBy.mockResolvedValue([]);
  }

  it("returns an empty map without querying anything for an empty assetIds array", async () => {
    const client = createMockBatchClient();

    const result = await getAssetAvailabilityBatch([], {
      organizationId: ORG_ID,
      window: null,
      db: client,
    });

    expect(result.size).toBe(0);
    expect(client.asset.findMany).not.toHaveBeenCalled();
    expect(client.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("requests standalone-only reserved rows (assetKitId: null) — the double-count fix", async () => {
    const client = createMockBatchClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);

    await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: { from: new Date("2026-01-01"), to: new Date("2026-01-31") },
      db: client,
    });

    // The reserved-rows call is the second `bookingAsset.findMany` call (the
    // first, inside `computeCheckedOutBatch`, has no such filter — checkedOut
    // is asset-on-active-booking, kit-driven or not).
    const reservedCall = client.bookingAsset.findMany.mock.calls[1];
    expect(reservedCall?.[0]?.where?.assetKitId).toBeNull();
  });

  it("scopes the total (asset.findMany) and inCustody (custody.groupBy) queries to the caller's organization", async () => {
    // Regression guard for an org-scoping gap: `asset.findMany` and
    // `custody.groupBy` previously filtered only by `assetId: { in: ... }`,
    // with no `organizationId` anywhere in their where-clauses — unlike
    // every other query this primitive issues. `getAssetAvailabilityBatch`
    // is an exported, reusable primitive (not a caller-trusted internal
    // helper like `computeAvailableQuantity`), so per
    // `.claude/rules/org-scope-user-supplied-ids.md` every query touching a
    // caller-supplied id must itself prove organization ownership.
    const client = createMockBatchClient();

    await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client,
    });

    expect(client.asset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, organizationId: ORG_ID },
      select: { id: true, quantity: true },
    });
    expect(client.custody.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: {
        assetId: { in: ["a1"] },
        asset: { organizationId: ORG_ID },
        // Operator custody only — kit-inherited custody is counted via inKits.
        kitCustodyId: null,
      },
      _sum: { quantity: true },
    });
  });

  it(
    "matches getAssetAvailability per-asset: kit-exclusion + overlap-summed " +
      "(asset 1), non-overlap-peaked (asset 2)",
    async () => {
      const window = {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-31T00:00:00Z"),
      };

      /**
       * Asset 1: inKits 3 (a kit membership the reserved query never sees,
       * because a real DB query already filters `assetKitId: null` — mirrors
       * the singular primitive's "excludes kit-driven rows" test) plus TWO
       * standalone reservations that genuinely overlap (peak = sum = 9).
       */
      const asset1Rows = [
        {
          assetId: "a1",
          bookingId: "b1",
          quantity: 4,
          booking: {
            from: new Date("2026-01-01T00:00:00Z"),
            to: new Date("2026-01-10T00:00:00Z"),
            status: "RESERVED",
          },
        },
        {
          assetId: "a1",
          bookingId: "b2",
          quantity: 5,
          booking: {
            from: new Date("2026-01-05T00:00:00Z"),
            to: new Date("2026-01-15T00:00:00Z"),
            status: "RESERVED",
          },
        },
      ];

      /**
       * Asset 2: TWO standalone reservations that never overlap (the
       * bb1/bb2 pattern) — peak (7) must win over the naive sum (14).
       */
      const asset2Rows = [
        {
          assetId: "a2",
          bookingId: "bb1",
          quantity: 7,
          booking: {
            from: new Date("2026-01-05T00:00:00Z"),
            to: new Date("2026-01-10T00:00:00Z"),
            status: "RESERVED",
          },
        },
        {
          assetId: "a2",
          bookingId: "bb2",
          quantity: 7,
          booking: {
            from: new Date("2026-01-15T00:00:00Z"),
            to: new Date("2026-01-20T00:00:00Z"),
            status: "RESERVED",
          },
        },
      ];

      /* ---- singular: asset 1 ---- */
      resetSingularMocks();
      computeAvailableQuantityMock.mockResolvedValue({
        total: 20,
        inCustody: 0,
      });
      // @ts-expect-error mocked
      db.assetKit.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
      // @ts-expect-error mocked
      db.bookingAsset.findMany.mockResolvedValue(
        asset1Rows.map(({ bookingId, quantity, booking }) => ({
          bookingId,
          quantity,
          booking,
        }))
      );
      const singular1 = await getAssetAvailability({
        assetId: "a1",
        organizationId: ORG_ID,
        window,
      });

      /* ---- singular: asset 2 ---- */
      resetSingularMocks();
      computeAvailableQuantityMock.mockResolvedValue({
        total: 10,
        inCustody: 0,
      });
      // @ts-expect-error mocked
      db.bookingAsset.findMany.mockResolvedValue(
        asset2Rows.map(({ bookingId, quantity, booking }) => ({
          bookingId,
          quantity,
          booking,
        }))
      );
      const singular2 = await getAssetAvailability({
        assetId: "a2",
        organizationId: ORG_ID,
        window,
      });

      /* ---- batch: both assets in one call ---- */
      const client = createMockBatchClient();
      client.asset.findMany.mockResolvedValue([
        { id: "a1", quantity: 20 },
        { id: "a2", quantity: 10 },
      ]);
      client.assetKit.groupBy.mockResolvedValue([
        { assetId: "a1", _sum: { quantity: 3 } },
      ]);
      // First call (inside computeCheckedOutBatch) returns no ONGOING/OVERDUE
      // pivots for either asset — checkedOut is 0 for both, matching the
      // singular calls above (`computeCheckedOutBreakdownForAssetMock`
      // resolves { total: 0, standalone: 0 }).
      client.bookingAsset.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([...asset1Rows, ...asset2Rows]);

      const batch = await getAssetAvailabilityBatch(["a1", "a2"], {
        organizationId: ORG_ID,
        window,
        db: client,
      });

      expect(batch.get("a1")).toEqual(singular1);
      expect(batch.get("a2")).toEqual(singular2);

      // Sanity on the actual numbers, not just cross-primitive equality —
      // asset 1's overlap sums (9), asset 2's non-overlap peaks (7).
      expect(batch.get("a1")?.reserved).toBe(9);
      expect(batch.get("a1")?.bookable).toBe(8); // 20 - 3(kits) - 9(reserved)
      expect(batch.get("a2")?.reserved).toBe(7);
      expect(batch.get("a2")?.reservedTotal).toBe(14);
      expect(batch.get("a2")?.bookable).toBe(3); // 10 - 7(reserved)
    }
  );

  it("computes checkedOut across multiple active bookings for one asset (legacy all-at-once + partial claim)", async () => {
    const client = createMockBatchClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 20 }]);

    // Booking "legacy" is ONGOING with zero PartialBookingCheckout sessions
    // — the legacy all-at-once fallback treats every booked unit (5) as
    // physically off the shelf. Booking "partial" booked 8 units and has
    // ONE session claiming 3 of them, leaving 5 still on the shelf (checked
    // out portion = 8 - 5 = 3). Total checkedOut = 5 + 3 = 8.
    client.bookingAsset.findMany.mockResolvedValueOnce([
      {
        assetId: "a1",
        bookingId: "legacy",
        quantity: 5,
        booking: {
          from: new Date("2026-01-01"),
          to: new Date("2026-01-05"),
        },
      },
      {
        assetId: "a1",
        bookingId: "partial",
        quantity: 8,
        booking: {
          from: new Date("2026-01-01"),
          to: new Date("2026-01-05"),
        },
      },
    ]);
    client.partialBookingCheckout.findMany.mockResolvedValue([
      {
        bookingId: "partial",
        assetIds: ["a1"],
        quantities: [3],
        bookingAssetIds: [""],
      },
    ]);
    // Second `bookingAsset.findMany` call is the reserved-rows read —
    // irrelevant here, no standalone reservations.
    client.bookingAsset.findMany.mockResolvedValueOnce([]);

    const result = await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client,
    });

    expect(result.get("a1")?.checkedOut).toBe(8);
    expect(result.get("a1")?.physicalAvailable).toBe(12); // 20 - 8
  });

  it("issues a constant number of queries regardless of asset-list size (no N+1)", async () => {
    // why: identical mock data for both runs (only the requested assetIds
    // differ) isolates the thing under test — call COUNT, not the returned
    // values — from data-dependent branching (e.g. the "no reserved rows"
    // skip) that could otherwise make the counts differ for a reason
    // unrelated to N.
    const sharedReservedRows = [
      {
        assetId: "a1",
        bookingId: "b1",
        quantity: 2,
        booking: { from: new Date("2026-01-01"), to: new Date("2026-01-05") },
      },
    ];
    const sharedPivots = [
      {
        assetId: "a1",
        bookingId: "ongoing1",
        quantity: 1,
        booking: { from: new Date("2026-01-01"), to: new Date("2026-01-05") },
      },
    ];

    function buildClient() {
      const client = createMockBatchClient();
      client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
      client.bookingAsset.findMany
        .mockResolvedValueOnce(sharedPivots) // computeCheckedOutBatch pivots
        .mockResolvedValueOnce(sharedReservedRows); // reserved rows
      client.partialBookingCheckout.findMany.mockResolvedValue([]);
      client.consumptionLog.groupBy.mockResolvedValue([]);
      return client;
    }

    const smallClient = buildClient();
    await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: { from: new Date("2026-01-01"), to: new Date("2026-01-31") },
      db: smallClient,
    });

    const largeClient = buildClient();
    await getAssetAvailabilityBatch(["a1", "a2", "a3"], {
      organizationId: ORG_ID,
      window: { from: new Date("2026-01-01"), to: new Date("2026-01-31") },
      db: largeClient,
    });

    // Every delegate's call count must be IDENTICAL between N=1 and N=3 —
    // the whole point of this primitive is a query count that doesn't scale
    // with the number of assets requested.
    expect(largeClient.asset.findMany.mock.calls.length).toBe(
      smallClient.asset.findMany.mock.calls.length
    );
    expect(largeClient.custody.groupBy.mock.calls.length).toBe(
      smallClient.custody.groupBy.mock.calls.length
    );
    expect(largeClient.assetKit.groupBy.mock.calls.length).toBe(
      smallClient.assetKit.groupBy.mock.calls.length
    );
    expect(largeClient.bookingAsset.findMany.mock.calls.length).toBe(
      smallClient.bookingAsset.findMany.mock.calls.length
    );
    expect(largeClient.partialBookingCheckout.findMany.mock.calls.length).toBe(
      smallClient.partialBookingCheckout.findMany.mock.calls.length
    );
    expect(largeClient.consumptionLog.groupBy.mock.calls.length).toBe(
      smallClient.consumptionLog.groupBy.mock.calls.length
    );

    // And concretely small: at most 2 bookingAsset reads (checkedOut pivots
    // + reserved rows) regardless of N — never one call per asset.
    expect(smallClient.bookingAsset.findMany.mock.calls.length).toBe(2);
    expect(largeClient.bookingAsset.findMany.mock.calls.length).toBe(2);
  });

  it(
    "matches getAssetAvailability's windowed-occupancy model: an OVERDUE " +
      "reservation's sentinel-extended interval reduces a future window " +
      "(batch/singular parity for the OVERDUE fix)",
    async () => {
      const window = {
        from: new Date("2026-09-01T00:00:00Z"),
        to: new Date("2026-09-05T00:00:00Z"),
      };
      const overdueRow = {
        assetId: "a1",
        bookingId: "od1",
        quantity: 4,
        booking: {
          from: new Date("2026-07-01T00:00:00Z"),
          to: new Date("2026-07-10T00:00:00Z"),
          status: "OVERDUE",
        },
      };

      /* ---- singular ---- */
      resetSingularMocks();
      computeAvailableQuantityMock.mockResolvedValue({
        total: 10,
        inCustody: 0,
      });
      computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
        total: 4,
        standalone: 4,
      });
      // @ts-expect-error mocked
      db.bookingAsset.findMany.mockResolvedValue([
        {
          bookingId: overdueRow.bookingId,
          quantity: overdueRow.quantity,
          booking: overdueRow.booking,
        },
      ]);
      const singular = await getAssetAvailability({
        assetId: "a1",
        organizationId: ORG_ID,
        window,
      });

      /* ---- batch ---- */
      const client = createMockBatchClient();
      client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 10 }]);
      // First call = computeCheckedOutBatch's ONGOING/OVERDUE pivots (this
      // OVERDUE booking IS physically checked out); second = reserved rows.
      client.bookingAsset.findMany
        .mockResolvedValueOnce([overdueRow])
        .mockResolvedValueOnce([overdueRow]);

      const batch = await getAssetAvailabilityBatch(["a1"], {
        organizationId: ORG_ID,
        window,
        db: client,
      });

      expect(batch.get("a1")).toEqual(singular);
      // Concrete numbers, not just cross-primitive equality: the sentinel
      // `to` makes the OVERDUE row occupy this far-future window even though
      // its real dates (Jul1–10) are nowhere near it.
      expect(batch.get("a1")?.reserved).toBe(4);
      expect(batch.get("a1")?.bookable).toBe(6); // 10 - 0 - 0 - 4(reserved)
      expect(batch.get("a1")?.checkedOut).toBe(4);
    }
  );
});

/* -------------------------------------------------------------------------- */
/*                       buildInsufficientStockMessage                        */
/* -------------------------------------------------------------------------- */

describe("buildInsufficientStockMessage", () => {
  it("builds the standardized shortfall message", () => {
    expect(
      buildInsufficientStockMessage({ available: 3, total: 10, unit: "boards" })
    ).toBe(
      "Only 3 of 10 boards available in this window — reduce the quantity to continue."
    );
  });

  it("falls back to 'units' when no unit of measure", () => {
    expect(
      buildInsufficientStockMessage({ available: 0, total: 5, unit: null })
    ).toBe(
      "Only 0 of 5 units available in this window — reduce the quantity to continue."
    );
  });

  it("clamps a negative available to 0 in the message", () => {
    expect(
      buildInsufficientStockMessage({ available: -7, total: 10, unit: null })
    ).toBe(
      "Only 0 of 10 units available in this window — reduce the quantity to continue."
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                       assertAssetQuantityAvailable                         */
/* -------------------------------------------------------------------------- */

describe("assertAssetQuantityAvailable", () => {
  // why: distinct from the globally-mocked `db` — see `createMockTx`'s doc
  // comment above for the regression this guards against. Reassigned fresh
  // in `resetMocks()` (rather than reset in place) so no test can leak a
  // custom `mockResolvedValue`/call-history into the next one.
  let mockTx: ReturnType<typeof createMockTx>;

  function resetMocks() {
    vitest.clearAllMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 10, inCustody: 0 });
    computeCheckedOutBreakdownForAssetMock.mockResolvedValue({
      total: 0,
      standalone: 0,
    });
    // @ts-expect-error mocked
    db.assetKit.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([]);
    // @ts-expect-error mocked
    db.consumptionLog.groupBy.mockResolvedValue([]);
    mockTx = createMockTx();
  }

  it("always allows a reduction, even when the pool is over-committed (#2725)", async () => {
    resetMocks();
    // bookable would compute to -7 if we ever queried it; requested 1,
    // current 8 is a reduction, so the guard must return before touching
    // availability at all.
    await expect(
      assertAssetQuantityAvailable({
        assetId: "a",
        organizationId: "o",
        tx: mockTx,
        window: null,
        currentQuantity: 8,
        requestedQuantity: 1,
        assetTitle: "Boards",
      })
    ).resolves.toBeUndefined();
    expect(db.bookingAsset.findMany).not.toHaveBeenCalled();
    expect(mockTx.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("always allows a no-op (requested === current)", async () => {
    resetMocks();
    await expect(
      assertAssetQuantityAvailable({
        assetId: "a",
        organizationId: "o",
        tx: mockTx,
        window: null,
        currentQuantity: 4,
        requestedQuantity: 4,
        assetTitle: "Boards",
      })
    ).resolves.toBeUndefined();
  });

  it("allows an increase within availability", async () => {
    resetMocks();
    // total 10, checked out 0, no reservations → bookable 10; current 2,
    // requested 5 → increase of 3, well within bookable → passes.
    await expect(
      assertAssetQuantityAvailable({
        assetId: "a",
        organizationId: "o",
        tx: mockTx,
        window: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
        currentQuantity: 2,
        requestedQuantity: 5,
        assetTitle: "Boards",
      })
    ).resolves.toBeUndefined();
  });

  it("threads the caller's tx into the reserved-quantity read, not the global db", async () => {
    resetMocks();
    // Same "allows an increase" scenario as above — the assertion here is
    // about WHICH client the reserved-quantity read ran on, not the
    // resulting bookable math. This is the regression guard for the "call
    // inside the mutation's transaction" contract: `assertAssetQuantityAvailable`
    // is meant to run behind `lockAssetForQuantityUpdate`, so if it silently
    // fell back to the untransacted global `db` for the reserved read, the
    // row lock would be defeated and the race #2725 exists to close would
    // reopen.
    await assertAssetQuantityAvailable({
      assetId: "a",
      organizationId: "o",
      tx: mockTx,
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-02T00:00:00Z"),
      },
      currentQuantity: 2,
      requestedQuantity: 5,
      assetTitle: "Boards",
    });

    expect(mockTx.bookingAsset.findMany).toHaveBeenCalled();
    expect(db.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("blocks an increase beyond availability with the standardized message", async () => {
    resetMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 5, inCustody: 0 });
    // A competing reservation of 2 (overlapping the guard's window) brings
    // bookable down to 3 (5 total − 2 reserved); current 2, requested 6 is
    // an increase of 4 > 3 bookable → must reject. The reservation is
    // configured on `mockTx` (not `db`) because the guard threads its `tx`
    // param into the reserved-quantity read — see the "threads the caller's
    // tx" test above.
    mockTx.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "other-booking",
        quantity: 2,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
      },
    ]);
    await expect(
      assertAssetQuantityAvailable({
        assetId: "a",
        organizationId: "o",
        tx: mockTx,
        window: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
        currentQuantity: 2,
        requestedQuantity: 6,
        assetTitle: "Boards",
        unitOfMeasure: "boards",
      })
    ).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      message: expect.stringContaining("available in this window"),
    });
  });

  it("rejects with the exact standardized message text", async () => {
    resetMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 5, inCustody: 0 });
    // Same competing-reservation setup as above: bookable ends at 3 (5 total −
    // 2 reserved by the other booking). `available` in the message is the true
    // max this booking may hold — `bookable` (3), NOT `current + bookable` —
    // because `bookable` already excludes this booking.
    mockTx.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "other-booking",
        quantity: 2,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
      },
    ]);
    await expect(
      assertAssetQuantityAvailable({
        assetId: "a",
        organizationId: "o",
        tx: mockTx,
        window: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
        currentQuantity: 2,
        requestedQuantity: 6,
        assetTitle: "Boards",
        unitOfMeasure: "boards",
      })
    ).rejects.toMatchObject({
      message:
        "Only 3 of 5 boards available in this window — reduce the quantity to continue.",
    });
  });

  it("rejects an increase to current+bookable — the absolute cap, not the delta (over-allocation regression)", async () => {
    resetMocks();
    // total 10, one OTHER booking reserving 7 in the same window → bookable 3.
    // Current 3 (this booking). The OLD guard compared the delta
    // (`requested − current > bookable`), so requested 6 (delta 3, not > 3)
    // slipped through — yet 6 + the other 7 = 13 oversubscribes the 10-unit
    // pool. The fix compares the ABSOLUTE requested against bookable, so the
    // real max is 3 (3 + 7 = 10), and anything above 3 is rejected.
    computeAvailableQuantityMock.mockResolvedValue({ total: 10, inCustody: 0 });
    mockTx.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "other-booking",
        quantity: 7,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
          status: "RESERVED",
        },
      },
    ]);
    const args = {
      assetId: "a",
      organizationId: "o",
      tx: mockTx,
      window: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-05T00:00:00Z"),
      },
      currentQuantity: 3,
      assetTitle: "Boards",
      unitOfMeasure: "boards",
    };
    // 6 (= current 3 + bookable 3) must now be REJECTED (was wrongly allowed).
    await expect(
      assertAssetQuantityAvailable({ ...args, requestedQuantity: 6 })
    ).rejects.toMatchObject({
      status: 400,
      message:
        "Only 3 of 10 boards available in this window — reduce the quantity to continue.",
    });
    // Exactly at the cap (bookable 3) is allowed.
    await expect(
      assertAssetQuantityAvailable({ ...args, requestedQuantity: 3 })
    ).resolves.toBeUndefined();
    // One over the cap is rejected.
    await expect(
      assertAssetQuantityAvailable({ ...args, requestedQuantity: 4 })
    ).rejects.toBeInstanceOf(ShelfError);
  });

  it("rejects with a ShelfError instance", async () => {
    resetMocks();
    computeAvailableQuantityMock.mockResolvedValue({ total: 5, inCustody: 0 });
    mockTx.bookingAsset.findMany.mockResolvedValue([
      {
        bookingId: "other-booking",
        quantity: 2,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
      },
    ]);
    await expect(
      assertAssetQuantityAvailable({
        assetId: "a",
        organizationId: "o",
        tx: mockTx,
        window: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-02T00:00:00Z"),
        },
        currentQuantity: 2,
        requestedQuantity: 6,
        assetTitle: "Boards",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });
});

/* -------------------------------------------------------------------------- */
/*                      assertAssetQuantitiesAvailable                        */
/* -------------------------------------------------------------------------- */

describe("assertAssetQuantitiesAvailable", () => {
  const ORG_ID = "org1";

  /**
   * A fresh `AvailabilityBatchClient`-shaped mock — same shape as
   * `getAssetAvailabilityBatch`'s own `createMockBatchClient()` above
   * (duplicated locally rather than hoisted out of that `describe` block,
   * since Vitest test files in this codebase keep per-`describe` fixtures
   * self-contained — see the sibling `createMockTx()` pattern for
   * `assertAssetQuantityAvailable`). Every method defaults to an empty
   * resolved value so a test only needs to override what it cares about.
   */
  function createMockBatchClient() {
    return {
      asset: { findMany: vitest.fn().mockResolvedValue([]) },
      custody: { groupBy: vitest.fn().mockResolvedValue([]) },
      assetKit: { groupBy: vitest.fn().mockResolvedValue([]) },
      bookingAsset: { findMany: vitest.fn().mockResolvedValue([]) },
      partialBookingCheckout: { findMany: vitest.fn().mockResolvedValue([]) },
      consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    };
  }

  it("is a no-op for an empty items array — no throw, no query", async () => {
    const client = createMockBatchClient();

    await expect(
      assertAssetQuantitiesAvailable([], {
        organizationId: ORG_ID,
        tx: client,
        window: null,
      })
    ).resolves.toBeUndefined();

    // Empty input must short-circuit before `getAssetAvailabilityBatch` is
    // ever called — no round-trip should fire for a no-op submission.
    expect(client.asset.findMany).not.toHaveBeenCalled();
    expect(client.bookingAsset.findMany).not.toHaveBeenCalled();
    expect(client.custody.groupBy).not.toHaveBeenCalled();
    expect(client.assetKit.groupBy).not.toHaveBeenCalled();
  });

  it("aggregates only the failing assets into one error, omitting ones that fit", async () => {
    const client = createMockBatchClient();
    // Widget: total 10, no reservations → bookable 10, requesting 5 → fits.
    // Gadget: total 5, no reservations → bookable 5, requesting 8 → shortfall.
    client.asset.findMany.mockResolvedValue([
      { id: "a1", quantity: 10 },
      { id: "a2", quantity: 5 },
    ]);

    const items = [
      { assetId: "a1", requestedQuantity: 5, assetTitle: "Widget" },
      {
        assetId: "a2",
        requestedQuantity: 8,
        assetTitle: "Gadget",
        unitOfMeasure: "boards",
      },
    ];

    let caught: ShelfError | undefined;
    try {
      await assertAssetQuantitiesAvailable(items, {
        organizationId: ORG_ID,
        tx: client,
        window: null,
      });
    } catch (err) {
      caught = err as ShelfError;
    }

    expect(caught).toBeInstanceOf(ShelfError);
    expect(caught?.status).toBe(400);
    expect(caught?.shouldBeCaptured).toBe(false);
    // Only the failing asset (Gadget) appears in the aggregated message.
    expect(caught?.message).toContain(
      '"Gadget": requested 8, only 5 of 5 boards available in this window'
    );
    expect(caught?.message).not.toContain("Widget");
    // The breakdown in `additionalData` mirrors the message — one entry, for
    // the failing asset only.
    expect(
      (caught?.additionalData as { shortfalls: unknown[] })?.shortfalls
    ).toHaveLength(1);
  });

  it("allows a reduction against the row's own prior quantity even when the pool is tight (#2725 directional rule)", async () => {
    const client = createMockBatchClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 5 }]);
    // Another booking has already reserved 20 units of a 5-total asset —
    // `bookable` would compute deeply negative if this item's request were
    // ever measured against it. But the item below is a REDUCTION (3 <= 8)
    // on its own prior quantity, so it must pass without even comparing to
    // `bookable`.
    client.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "a1",
        bookingId: "other-booking",
        quantity: 20,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-05T00:00:00Z"),
          status: "RESERVED",
        },
      },
    ]);

    await expect(
      assertAssetQuantitiesAvailable(
        [
          {
            assetId: "a1",
            currentQuantity: 8,
            requestedQuantity: 3,
            assetTitle: "Widget",
          },
        ],
        { organizationId: ORG_ID, tx: client, window: null }
      )
    ).resolves.toBeUndefined();
  });

  it("checks a brand-new booking's item absolutely when currentQuantity is omitted (defaults to 0)", async () => {
    const client = createMockBatchClient();
    client.asset.findMany.mockResolvedValue([{ id: "a1", quantity: 5 }]);

    // No `currentQuantity` supplied — a new booking has nothing existing to
    // compare against, so the request (6) is checked absolutely against
    // bookable (5) and must be rejected.
    await expect(
      assertAssetQuantitiesAvailable(
        [{ assetId: "a1", requestedQuantity: 6, assetTitle: "Widget" }],
        { organizationId: ORG_ID, tx: client, window: null }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(
        '"Widget": requested 6, only 5 of 5 units available in this window'
      ),
    });

    // Requesting exactly the bookable amount passes.
    await expect(
      assertAssetQuantitiesAvailable(
        [{ assetId: "a1", requestedQuantity: 5, assetTitle: "Widget" }],
        { organizationId: ORG_ID, tx: client, window: null }
      )
    ).resolves.toBeUndefined();
  });

  it("treats an asset id missing from the batch result as zero bookable (conservative, never silently skipped)", async () => {
    const client = createMockBatchClient();
    // `asset.findMany` returns nothing for "ghost" — the batch map will have
    // no entry for it.
    client.asset.findMany.mockResolvedValue([]);

    await expect(
      assertAssetQuantitiesAvailable(
        [{ assetId: "ghost", requestedQuantity: 1, assetTitle: "Ghost" }],
        { organizationId: ORG_ID, tx: client, window: null }
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        '"Ghost": requested 1, only 0 of 0 units available in this window'
      ),
    });
  });

  it("performs exactly one batched read regardless of item count — no per-asset fan-out", async () => {
    const client = createMockBatchClient();
    client.asset.findMany.mockResolvedValue([
      { id: "a1", quantity: 10 },
      { id: "a2", quantity: 10 },
      { id: "a3", quantity: 10 },
    ]);

    const items = ["a1", "a2", "a3"].map((assetId) => ({
      assetId,
      requestedQuantity: 2,
      assetTitle: assetId,
    }));

    await assertAssetQuantitiesAvailable(items, {
      organizationId: ORG_ID,
      tx: client,
      window: null,
    });

    // why: proves the guard issues ONE getAssetAvailabilityBatch read — one
    // `asset.findMany`/`custody.groupBy`/`assetKit.groupBy` call with every
    // id batched into a single `{ in: [...] }` filter — rather than fanning
    // out a separate `getAssetAvailability` call per item, each of which
    // would issue its own asset/custody/kit/reservation round-trips. The
    // call count must stay flat as item count grows from 1 to 3.
    expect(client.asset.findMany).toHaveBeenCalledTimes(1);
    expect(client.custody.groupBy).toHaveBeenCalledTimes(1);
    expect(client.assetKit.groupBy).toHaveBeenCalledTimes(1);
    // The reserved-rows read is the batch primitive's other query — also
    // exactly one call regardless of item count (plus one more for the
    // checked-out pivots read inside `computeCheckedOutBatch`).
    expect(client.bookingAsset.findMany).toHaveBeenCalledTimes(2);
  });
});

/* -------------------------------------------------------------------------- */
/*                 assertAssetQuantityNotBelowReservations                    */
/* -------------------------------------------------------------------------- */

describe("assertAssetQuantityNotBelowReservations", () => {
  const ASSET_ID = "asset1";
  const ORG_ID = "org1";

  /**
   * Same `AvailabilityBatchClient`-shaped mock convention as the batch
   * primitive's own `createMockBatchClient()` above (duplicated locally per
   * this file's per-`describe` fixture convention) — only the subset of
   * delegates this guard actually queries (`custody`, `assetKit`,
   * `bookingAsset`, `consumptionLog`) needs stubbing.
   */
  function createMockTx() {
    return {
      custody: { groupBy: vitest.fn().mockResolvedValue([]) },
      assetKit: { groupBy: vitest.fn().mockResolvedValue([]) },
      bookingAsset: { findMany: vitest.fn().mockResolvedValue([]) },
      consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    };
  }

  /** A standalone (non-kit-driven), RESERVED `BookingAsset` row fixture. */
  function reservedRow(
    bookingId: string,
    quantity: number,
    from: string,
    to: string,
    status = "RESERVED"
  ) {
    return {
      assetId: ASSET_ID,
      bookingId,
      quantity,
      booking: { from: new Date(from), to: new Date(to), status },
    };
  }

  it("allows any newTotal >= 0 when there are no commitments (custody, kits, or bookings)", async () => {
    const tx = createMockTx();

    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 0,
        assetTitle: "Widget",
      })
    ).resolves.toBeUndefined();

    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 1000,
        assetTitle: "Widget",
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a newTotal below the committed peak (custody + kits + reserved)", async () => {
    const tx = createMockTx();
    tx.custody.groupBy.mockResolvedValue([
      { assetId: ASSET_ID, _sum: { quantity: 3 } },
    ]);
    tx.assetKit.groupBy.mockResolvedValue([
      { assetId: ASSET_ID, _sum: { quantity: 2 } },
    ]);
    tx.bookingAsset.findMany.mockResolvedValue([
      reservedRow("b1", 5, "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z"),
    ]);

    // committed = 3 (custody) + 2 (kits) + 5 (reserved) = 10
    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 9,
        assetTitle: "Widget",
        unitOfMeasure: "boards",
      })
    ).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      message:
        'Cannot reduce "Widget" to 9 boards — 10 boards are committed ' +
        "(custody, kits, or overlapping bookings). Release or reduce those first.",
      additionalData: expect.objectContaining({
        inCustody: 3,
        inKits: 2,
        peakReserved: 5,
        committed: 10,
      }),
    });
  });

  it("allows a reduction to EXACTLY the committed peak (not over, not under)", async () => {
    const tx = createMockTx();
    tx.custody.groupBy.mockResolvedValue([
      { assetId: ASSET_ID, _sum: { quantity: 3 } },
    ]);
    tx.assetKit.groupBy.mockResolvedValue([
      { assetId: ASSET_ID, _sum: { quantity: 2 } },
    ]);
    tx.bookingAsset.findMany.mockResolvedValue([
      reservedRow("b1", 5, "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z"),
    ]);

    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 10,
        assetTitle: "Widget",
      })
    ).resolves.toBeUndefined();
  });

  it("uses the PEAK across non-overlapping bookings, not their sum (bb1/bb2)", async () => {
    const tx = createMockTx();
    // Two standalone RESERVED rows of 7 each, never overlapping — a naive
    // sum would compute committed = 14 and wrongly reject a reduction to 7.
    tx.bookingAsset.findMany.mockResolvedValue([
      reservedRow("bb1", 7, "2026-07-28T08:56:00Z", "2026-07-29T15:00:00Z"),
      reservedRow("bb2", 7, "2026-07-30T08:58:00Z", "2026-08-01T15:00:00Z"),
    ]);

    // committed = peak(7), not sum(14) — reducing to 7 is safe.
    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 7,
        assetTitle: "Widget",
      })
    ).resolves.toBeUndefined();

    // One below the peak is rejected.
    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 6,
        assetTitle: "Widget",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("nets already-logged dispositions (RETURN/CONSUME/LOSS/DAMAGE) out of a booking's remaining commitment", async () => {
    const tx = createMockTx();
    // Booked 5, but 3 already returned via partial check-in — remaining 2.
    tx.bookingAsset.findMany.mockResolvedValue([
      reservedRow("b1", 5, "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z"),
    ]);
    tx.consumptionLog.groupBy.mockResolvedValue([
      { bookingId: "b1", assetId: ASSET_ID, _sum: { quantity: 3 } },
    ]);

    // committed = 2 (remaining), so a reduction to 2 is safe, to 1 is not.
    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 2,
        assetTitle: "Widget",
      })
    ).resolves.toBeUndefined();
    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 1,
        assetTitle: "Widget",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("does not date-window the reservation read — an OVERDUE booking's stale window still counts", async () => {
    const tx = createMockTx();
    // OVERDUE booking whose own dates are long past — this guard protects
    // the WHOLE future timeline (no `window`), so it must still count.
    tx.bookingAsset.findMany.mockResolvedValue([
      reservedRow(
        "od1",
        4,
        "2020-01-01T00:00:00Z",
        "2020-01-10T00:00:00Z",
        "OVERDUE"
      ),
    ]);

    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 3,
        assetTitle: "Widget",
      })
    ).rejects.toMatchObject({ status: 400 });

    // The query must ask for every active reservation with no date window —
    // `buildActiveBookingWhere(organizationId, null)` never sets `OR`.
    const call = tx.bookingAsset.findMany.mock.calls[0]?.[0] as {
      where?: { booking?: { OR?: unknown } };
    };
    expect(call?.where?.booking?.OR).toBeUndefined();
  });

  it("issues a constant number of queries regardless of how many bookings reserve the asset (no per-booking fan-out)", async () => {
    const txFew = createMockTx();
    txFew.bookingAsset.findMany.mockResolvedValue([
      reservedRow("b1", 1, "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z"),
    ]);
    await assertAssetQuantityNotBelowReservations({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      tx: txFew,
      newTotal: 100,
      assetTitle: "Widget",
    });

    const txMany = createMockTx();
    txMany.bookingAsset.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) =>
        reservedRow(`b${i}`, 1, "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z")
      )
    );
    await assertAssetQuantityNotBelowReservations({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      tx: txMany,
      newTotal: 100,
      assetTitle: "Widget",
    });

    // Same fixed call count (custody + kits + reserved rows + logged
    // dispositions = 4) whether there's 1 booking or 25.
    expect(txFew.custody.groupBy).toHaveBeenCalledTimes(1);
    expect(txFew.assetKit.groupBy).toHaveBeenCalledTimes(1);
    expect(txFew.bookingAsset.findMany).toHaveBeenCalledTimes(1);
    expect(txFew.consumptionLog.groupBy).toHaveBeenCalledTimes(1);

    expect(txMany.custody.groupBy).toHaveBeenCalledTimes(1);
    expect(txMany.assetKit.groupBy).toHaveBeenCalledTimes(1);
    expect(txMany.bookingAsset.findMany).toHaveBeenCalledTimes(1);
    expect(txMany.consumptionLog.groupBy).toHaveBeenCalledTimes(1);
  });

  it("skips the logged-dispositions query entirely when there are no reserved rows", async () => {
    const tx = createMockTx();
    tx.custody.groupBy.mockResolvedValue([
      { assetId: ASSET_ID, _sum: { quantity: 2 } },
    ]);

    await assertAssetQuantityNotBelowReservations({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      tx,
      newTotal: 2,
      assetTitle: "Widget",
    });

    expect(tx.consumptionLog.groupBy).not.toHaveBeenCalled();
  });

  it("scopes the custody and kit queries to the caller's organization", async () => {
    const tx = createMockTx();

    await assertAssetQuantityNotBelowReservations({
      assetId: ASSET_ID,
      organizationId: ORG_ID,
      tx,
      newTotal: 5,
      assetTitle: "Widget",
    });

    expect(tx.custody.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: {
        assetId: ASSET_ID,
        asset: { organizationId: ORG_ID },
        // Operator custody only — kit-inherited custody is counted via inKits.
        kitCustodyId: null,
      },
      _sum: { quantity: true },
    });
    expect(tx.assetKit.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: { assetId: ASSET_ID, organizationId: ORG_ID },
      _sum: { quantity: true },
    });
  });

  it("falls back to generic title/unit text when omitted", async () => {
    const tx = createMockTx();
    tx.custody.groupBy.mockResolvedValue([
      { assetId: ASSET_ID, _sum: { quantity: 5 } },
    ]);

    await expect(
      assertAssetQuantityNotBelowReservations({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        newTotal: 1,
      })
    ).rejects.toMatchObject({
      message:
        'Cannot reduce "This asset" to 1 units — 5 units are committed ' +
        "(custody, kits, or overlapping bookings). Release or reduce those first.",
    });
  });
});
