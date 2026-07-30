/**
 * Focused unit tests for `buildAvailableUnitsByAsset`, the builder behind
 * the booking-overview "Insufficient stock" badge (Task 9 of the
 * QT-availability-unification plan).
 *
 * Historically this map was built from two GLOBAL (un-windowed)
 * `db.bookingAsset.groupBy` calls, so a row backed only by a legitimately
 * NON-overlapping other booking still inflated `reserved` and could
 * false-fire the badge; the groupBys also had no `assetKitId: null` filter,
 * so kit-driven rows were double-counted on top of a separate `inKits`-style
 * subtraction they never even had. `buildAvailableUnitsByAsset` now
 * delegates to the shared, already-covered `getAssetAvailabilityBatch`
 * primitive (windowed peak-concurrent sweep + kit-driven exclusion).
 *
 * These tests mock only `~/database/db.server` (per `test/mocks/database.ts`
 * conventions) and drive the REAL `getAssetAvailabilityBatch` underneath, so
 * the windowing/kit-dedup behaviour is exercised end-to-end at the builder
 * boundary, not just asserted via a stubbed return value. The
 * `bookingAsset.findMany` mock used for the "reserved rows" read actively
 * emulates Postgres date-overlap filtering (reading the same `booking.OR`
 * shape `getAssetAvailabilityBatch` constructs) rather than returning canned
 * rows unconditionally — otherwise a mock can't distinguish "the code asked
 * for a windowed read and Postgres excluded the row" from "the code never
 * asked for a window at all", which is the exact bug being fixed here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: `buildAvailableUnitsByAsset` calls `getAssetAvailabilityBatch` with no
// explicit `db:` override, so it reads the module-level `db` singleton. We
// mock only the Prisma delegate methods the batch primitive touches
// (`AvailabilityBatchClient`), matching the pattern in
// `availability.server.test.ts`'s own `getAssetAvailabilityBatch` suite.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn() },
    custody: { groupBy: vi.fn() },
    assetKit: { groupBy: vi.fn() },
    bookingAsset: { findMany: vi.fn() },
    partialBookingCheckout: { findMany: vi.fn() },
    consumptionLog: { groupBy: vi.fn() },
  },
}));

import { db } from "~/database/db.server";
import { buildAvailableUnitsByAsset } from "~/modules/booking/booking-overview-availability.server";

// @vitest-environment node

const ORG_ID = "org1";
const THIS_BOOKING_ID = "booking-self";

type ReservedRowFixture = {
  assetId: string;
  bookingId: string;
  quantity: number;
  booking: { from: Date; to: Date };
};

function mockedDb() {
  return db as unknown as {
    asset: { findMany: ReturnType<typeof vi.fn> };
    custody: { groupBy: ReturnType<typeof vi.fn> };
    assetKit: { groupBy: ReturnType<typeof vi.fn> };
    bookingAsset: { findMany: ReturnType<typeof vi.fn> };
    partialBookingCheckout: { findMany: ReturnType<typeof vi.fn> };
    consumptionLog: { groupBy: ReturnType<typeof vi.fn> };
  };
}

/**
 * Wires `bookingAsset.findMany` to behave like a real Postgres call for the
 * two shapes `getAssetAvailabilityBatch` issues against it:
 *  - `computeCheckedOutBatch`'s ONGOING/OVERDUE pivots read (no `assetKitId`
 *    key on `where` at all) — always empty in these tests (no checkouts).
 *  - The standalone reserved-rows read (`assetKitId: null` present) — here
 *    we actually APPLY the `where.booking.OR` filter to `candidateRows`,
 *    exactly like Postgres would. Since the windowed-occupancy fix
 *    (`buildActiveBookingWhere`), that `OR` has TWO branches: an unconditional
 *    `{status: OVERDUE}` branch and a date-overlap `{AND: [...]}` branch. None
 *    of these fixtures model an OVERDUE row, so only the AND branch is ever
 *    exercised here — a non-overlapping RESERVED/ONGOING candidate is still
 *    genuinely excluded rather than merely hoped-to-be-ignored by
 *    application code.
 */
function wireReservedRows(
  client: ReturnType<typeof mockedDb>,
  candidateRows: ReservedRowFixture[]
) {
  client.bookingAsset.findMany.mockImplementation(
    (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (!("assetKitId" in where)) {
        // computeCheckedOutBatch pivots — no checked-out rows in these tests.
        return Promise.resolve([]);
      }
      const bookingWhere = where.booking as
        | {
            OR?: Array<
              | { status: string }
              | { AND: [{ from: { lt: Date } }, { to: { gt: Date } }] }
            >;
          }
        | undefined;
      const dateBranch = bookingWhere?.OR?.find(
        (
          branch
        ): branch is {
          AND: [{ from: { lt: Date } }, { to: { gt: Date } }];
        } => "AND" in branch
      );
      if (!dateBranch) {
        // Un-windowed read — every candidate row is a plain-total contributor.
        return Promise.resolve(candidateRows);
      }
      const windowTo = dateBranch.AND[0].from.lt;
      const windowFrom = dateBranch.AND[1].to.gt;
      return Promise.resolve(
        candidateRows.filter(
          (row) => row.booking.from < windowTo && row.booking.to > windowFrom
        )
      );
    }
  );
}

describe("buildAvailableUnitsByAsset", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const client = mockedDb();
    client.asset.findMany.mockResolvedValue([]);
    client.custody.groupBy.mockResolvedValue([]);
    client.assetKit.groupBy.mockResolvedValue([]);
    client.bookingAsset.findMany.mockResolvedValue([]);
    client.partialBookingCheckout.findMany.mockResolvedValue([]);
    client.consumptionLog.groupBy.mockResolvedValue([]);
  });

  it("(a) does not fire the badge for a row whose only OTHER competing booking is NON-overlapping", async () => {
    // Asset total 10. THIS booking (excluded) books units for a February
    // window; the ONLY other competing booking ("other-jan") reserves 8
    // units in January — entirely outside this booking's window. A
    // correctly-windowed read must exclude it (Postgres would never return
    // it for the date-overlap WHERE clause), leaving the full 10 bookable.
    const client = mockedDb();
    client.asset.findMany.mockResolvedValue([{ id: "asset-a", quantity: 10 }]);
    wireReservedRows(client, [
      {
        assetId: "asset-a",
        bookingId: "other-jan",
        quantity: 8,
        booking: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-10T00:00:00Z"),
        },
      },
    ]);

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-a", type: "QUANTITY_TRACKED" as any }],
      qtyAssetIdsInBooking: ["asset-a"],
      organizationId: ORG_ID,
      booking: {
        id: THIS_BOOKING_ID,
        from: new Date("2026-02-01T00:00:00Z"),
        to: new Date("2026-02-10T00:00:00Z"),
      },
    });

    // A row booking up to 10 units on THIS booking would NOT trigger
    // "Insufficient stock" — the non-overlapping January booking doesn't
    // compete for February capacity. The old GLOBAL groupBy had no date
    // filter at all, so it would have summed the 8 regardless of window and
    // reported only 2 available here — a false positive.
    expect(result["asset-a"].bookable).toBe(10);

    // Confirms a window (derived from booking.from/to) is actually sent —
    // the old query had NO such clause (that's the bug being fixed). The `OR`
    // now has TWO branches (windowed-occupancy fix): an unconditional
    // `{status: OVERDUE}` branch (an overdue-not-returned unit has no known
    // return date, so it must be considered for every window) plus the
    // date-overlap `AND` branch for RESERVED/ONGOING.
    const reservedCall = client.bookingAsset.findMany.mock.calls.find(
      (call) => "assetKitId" in (call[0]?.where ?? {})
    )?.[0];
    expect(reservedCall?.where?.booking?.OR).toEqual([
      { status: "OVERDUE" },
      {
        AND: [
          { from: { lt: new Date("2026-02-10T00:00:00Z") } },
          { to: { gt: new Date("2026-02-01T00:00:00Z") } },
        ],
      },
    ]);
    // The reserved-rows query must exclude the current booking (mirrors the
    // old groupBys' `id: { not: bookingId }`).
    expect(reservedCall?.where?.bookingId).toEqual({ not: THIS_BOOKING_ID });
  });

  it("(b) fires the badge for a genuine IN-WINDOW over-commit from another booking", async () => {
    // Asset total 10. Another booking ("other-overlap") reserves 8 units
    // squarely inside this booking's window — only 2 units are left, so a
    // row requesting more than 2 must trip the badge.
    const client = mockedDb();
    client.asset.findMany.mockResolvedValue([{ id: "asset-b", quantity: 10 }]);
    wireReservedRows(client, [
      {
        assetId: "asset-b",
        bookingId: "other-overlap",
        quantity: 8,
        booking: {
          from: new Date("2026-02-03T00:00:00Z"),
          to: new Date("2026-02-05T00:00:00Z"),
        },
      },
    ]);

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-b", type: "QUANTITY_TRACKED" as any }],
      qtyAssetIdsInBooking: ["asset-b"],
      organizationId: ORG_ID,
      booking: {
        id: THIS_BOOKING_ID,
        from: new Date("2026-02-01T00:00:00Z"),
        to: new Date("2026-02-10T00:00:00Z"),
      },
    });

    // A row booking e.g. 5 units on this asset now correctly exceeds the 2
    // available and fires "Insufficient stock" downstream
    // (`hasInsufficientStock = bookedQuantity > availableUnitsByAsset[id]`).
    expect(result["asset-b"].bookable).toBe(2);
  });

  it("(c) does not double-count kit-driven competing rows against inKits", async () => {
    // Asset total 20, with 5 units allocated into a kit (`inKits`). A
    // standalone 3-unit reservation on another (overlapping) booking is the
    // ONLY thing that should further reduce availability — kit-driven rows
    // are never returned by the real `assetKitId: null` filter, so they
    // can't also be summed into `reserved` on top of `inKits`.
    const client = mockedDb();
    client.asset.findMany.mockResolvedValue([{ id: "asset-c", quantity: 20 }]);
    client.assetKit.groupBy.mockResolvedValue([
      { assetId: "asset-c", _sum: { quantity: 5 } },
    ]);
    wireReservedRows(client, [
      {
        assetId: "asset-c",
        bookingId: "other-standalone",
        quantity: 3,
        booking: {
          from: new Date("2026-02-03T00:00:00Z"),
          to: new Date("2026-02-05T00:00:00Z"),
        },
      },
    ]);

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-c", type: "QUANTITY_TRACKED" as any }],
      qtyAssetIdsInBooking: ["asset-c"],
      organizationId: ORG_ID,
      booking: {
        id: THIS_BOOKING_ID,
        from: new Date("2026-02-01T00:00:00Z"),
        to: new Date("2026-02-10T00:00:00Z"),
      },
    });

    // 20 total - 5 (inKits) - 3 (standalone reserved) = 12. If the old bug
    // (summing every BookingAsset row incl. kit-driven ones, which the old
    // query never filtered out at all) were present, this would
    // double-count and under-report availability.
    expect(result["asset-c"].bookable).toBe(12);

    const reservedCall = client.bookingAsset.findMany.mock.calls.find(
      (call) => "assetKitId" in (call[0]?.where ?? {})
    )?.[0];
    expect(reservedCall?.where?.assetKitId).toBeNull();
  });

  it("clamps a negative bookable figure to 0 for display", async () => {
    const client = mockedDb();
    client.asset.findMany.mockResolvedValue([{ id: "asset-d", quantity: 5 }]);
    wireReservedRows(client, [
      {
        assetId: "asset-d",
        bookingId: "other-over",
        quantity: 9,
        booking: {
          from: new Date("2026-02-01T00:00:00Z"),
          to: new Date("2026-02-10T00:00:00Z"),
        },
      },
    ]);

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-d", type: "QUANTITY_TRACKED" as any }],
      qtyAssetIdsInBooking: ["asset-d"],
      organizationId: ORG_ID,
      booking: {
        id: THIS_BOOKING_ID,
        from: new Date("2026-02-01T00:00:00Z"),
        to: new Date("2026-02-10T00:00:00Z"),
      },
    });

    expect(result["asset-d"].bookable).toBe(0);
  });

  it("skips INDIVIDUAL assets and omits assets with no QT ids requested", async () => {
    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-individual", type: "INDIVIDUAL" as any }],
      qtyAssetIdsInBooking: [],
      organizationId: ORG_ID,
      booking: {
        id: THIS_BOOKING_ID,
        from: new Date("2026-02-01T00:00:00Z"),
        to: new Date("2026-02-10T00:00:00Z"),
      },
    });

    expect(result).toEqual({});
  });

  it("falls back to an un-windowed read when the booking has no from/to (DRAFT)", async () => {
    const client = mockedDb();
    client.asset.findMany.mockResolvedValue([{ id: "asset-e", quantity: 10 }]);
    wireReservedRows(client, [
      {
        assetId: "asset-e",
        bookingId: "other-1",
        quantity: 4,
        booking: { from: new Date("2026-01-01"), to: new Date("2026-01-05") },
      },
    ]);

    const result = await buildAvailableUnitsByAsset({
      rawAssets: [{ id: "asset-e", type: "QUANTITY_TRACKED" as any }],
      qtyAssetIdsInBooking: ["asset-e"],
      organizationId: ORG_ID,
      booking: { id: THIS_BOOKING_ID, from: null, to: null },
    });

    // No window → plain (non-peaked) total is subtracted: 10 - 4 = 6.
    expect(result["asset-e"].bookable).toBe(6);
    const reservedCall = client.bookingAsset.findMany.mock.calls.find(
      (call) => "assetKitId" in (call[0]?.where ?? {})
    )?.[0];
    expect(reservedCall?.where?.booking?.OR).toBeUndefined();
  });
});
