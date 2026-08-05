// @vitest-environment node
// why: `booking/service.server.ts` transitively imports scanner-drawer React
// components (for their zod schemas), which pull in `lottie-web`. Under the
// default `happy-dom` environment, lottie-web crashes at import time trying
// to get a 2D canvas context happy-dom doesn't implement. Running this file
// under the plain `node` environment (no DOM) sidesteps that import-time
// crash — same fix `app/modules/user/demotion-booking-visibility.test.ts`
// already uses for the same transitive import.
/**
 * Parity test: `getAssetAvailabilityBatch`'s batched `checkedOut` math vs
 * the real, single-asset `computeCheckedOutForAsset` (`~/modules/booking/service.server`).
 *
 * `getAssetAvailabilityBatch` reimplements `computeCheckedOutForAsset`'s
 * physically-out formula directly (see `computeCheckedOutBatch`'s JSDoc in
 * `availability.server.ts`) rather than calling it per asset, to avoid an
 * N+1 fan-out. Reimplementation means the two formulas can silently drift —
 * exactly the failure mode the whole QT-availability-unification project
 * exists to eliminate. This file runs BOTH real implementations against the
 * SAME in-memory fixture and asserts they agree, for every branch
 * `computeCheckedOutForAsset` has: a legacy all-at-once checkout (zero
 * `PartialBookingCheckout` sessions), a partial checkout with a claimed
 * portion, and multiple active bookings for one asset summed together.
 *
 * // why: this lives in its own file, separate from `availability.server.test.ts`,
 * // because that file's `vitest.mock("~/modules/booking/service.server", ...)`
 * // stubs `computeCheckedOutForAsset` out entirely (by design — it isolates
 * // `getAssetAvailability`'s composition logic from that collaborator's
 * // internals). This suite needs the OPPOSITE: the REAL
 * // `computeCheckedOutForAsset` running against a REAL (in-memory) fixture,
 * // so the two implementations can be compared rather than one standing in
 * // for the other. Only `~/database/db.server` is stubbed (to `{ db: {} }`,
 * // following the same pattern as
 * // `app/modules/user/demotion-booking-visibility.test.ts`) so importing the
 * // real `booking/service.server.ts` module doesn't try to open a live
 * // Postgres connection — neither function under test reads the global `db`
 * // singleton directly; both take their Prisma client as an explicit `tx`/`db`
 * // argument, which this suite always supplies as the fixture-backed fake.
 */
import { BookingStatus } from "@prisma/client";
import { describe, expect, it, vitest } from "vitest";
import { computeCheckedOutForAsset } from "~/modules/booking/checked-out.server";
import type { AvailabilityBatchClient } from "./availability.server";
import { getAssetAvailabilityBatch } from "./availability.server";

// why: see the module doc above — importing the real `booking/service.server`
// module (for the real `computeCheckedOutForAsset`) transitively imports
// `~/database/db.server`, which calls `createDatabaseClient()` as an
// import-time side effect. Neither function under test touches the global
// `db` singleton (both take an explicit client/tx argument), so a bare stub
// is enough to keep this suite off a real Prisma client.
vitest.mock("~/database/db.server", () => ({ db: {} }));

const ORG_ID = "org1";

/** One `BookingAsset` row in the in-memory fixture. */
type FixtureBookingAsset = {
  /**
   * `BookingAsset.id` — needed to attribute checkout claims per slice. Optional
   * in fixtures: single-slice rows can omit it (a stable id is synthesized);
   * multi-slice rows for the SAME (asset, booking) MUST set distinct ids so the
   * standalone-first greedy attribution can tell them apart.
   */
  id?: string;
  assetId: string;
  bookingId: string;
  quantity: number;
  /** `null`/omitted = standalone (free-pool) slice; a value = kit-driven slice. */
  assetKitId?: string | null;
};

/** One `Asset` row in the in-memory fixture (only `quantity`, the availability `total`). */
type FixtureAsset = {
  id: string;
  quantity: number;
};

/** One `AssetKit` membership row in the in-memory fixture (feeds `inKits`). */
type FixtureAssetKit = {
  assetId: string;
  quantity: number;
};

/** One `Booking` row in the in-memory fixture (only the fields these formulas read). */
type FixtureBooking = {
  id: string;
  status: BookingStatus;
  organizationId: string;
};

/** One `PartialBookingCheckout` session row in the in-memory fixture. */
type FixtureSession = {
  bookingId: string;
  assetIds: string[];
  quantities: number[];
  bookingAssetIds: string[];
};

/** A Prisma `{ in: [...] }` / `{ not: ... }` filter, or a bare scalar. */
type ScalarFilter = string | { in: string[] } | { not: string } | undefined;

/** Evaluates the small subset of Prisma scalar filters this fixture needs. */
function matchesFilter(value: string, filter: ScalarFilter): boolean {
  if (filter === undefined) return true;
  if (typeof filter === "string") return value === filter;
  if ("in" in filter) return filter.in.includes(value);
  if ("not" in filter) return value !== filter.not;
  return true;
}

/**
 * Builds an in-memory fake satisfying both {@link AvailabilityBatchClient}
 * (what `getAssetAvailabilityBatch` needs) and the `tx: any` surface
 * `computeCheckedOutForAsset` / `computeCheckedOutBreakdownForAsset` need —
 * driven by the SAME fixture rows, so both real implementations read identical
 * underlying data. `asset`/`assetKit` are backed by optional fixtures so tests
 * that assert `physicalAvailable` (which needs `total` and `inKits`) can supply
 * them; `custody`/`consumptionLog` stay stubbed empty (not exercised here).
 *
 * @param fixture - The booking-assets, bookings, checkout sessions, and
 *   (optionally) assets + kit memberships both formulas under test will query.
 */
function createFakeClient(fixture: {
  bookingAssets: FixtureBookingAsset[];
  bookings: FixtureBooking[];
  sessions: FixtureSession[];
  assets?: FixtureAsset[];
  assetKits?: FixtureAssetKit[];
}) {
  const bookingById = new Map(fixture.bookings.map((b) => [b.id, b]));
  const assets = fixture.assets ?? [];
  const assetKits = fixture.assetKits ?? [];

  // Pre-assign every BookingAsset row a stable id (synthesized when the fixture
  // omits one) and normalize `assetKitId` to `null` — so both reads return the
  // SAME id for the same row and the per-slice attributor sees unique keys.
  const bookingAssetRows = fixture.bookingAssets.map((row, i) => ({
    id: row.id ?? `ba-${i}`,
    assetId: row.assetId,
    bookingId: row.bookingId,
    quantity: row.quantity,
    assetKitId: row.assetKitId ?? null,
  }));

  return {
    asset: {
      findMany: vitest.fn(({ where }: { where: { id?: { in: string[] } } }) =>
        assets
          .filter((a) => !where.id || where.id.in.includes(a.id))
          .map((a) => ({ id: a.id, quantity: a.quantity }))
      ),
    },
    custody: { groupBy: vitest.fn().mockResolvedValue([]) },
    assetKit: {
      groupBy: vitest.fn(
        ({ where }: { where: { assetId?: { in: string[] } } }) => {
          const sumByAsset = new Map<string, number>();
          for (const k of assetKits) {
            if (where.assetId && !where.assetId.in.includes(k.assetId))
              continue;
            sumByAsset.set(
              k.assetId,
              (sumByAsset.get(k.assetId) ?? 0) + k.quantity
            );
          }
          return [...sumByAsset].map(([assetId, quantity]) => ({
            assetId,
            _sum: { quantity },
          }));
        }
      ),
    },
    consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    bookingAsset: {
      findMany: vitest.fn(
        ({
          where,
        }: {
          where: {
            assetId?: ScalarFilter;
            bookingId?: ScalarFilter;
            assetKitId?: null;
            booking?: { status?: ScalarFilter; organizationId?: string };
          };
        }) =>
          bookingAssetRows
            .filter((row) => {
              if (!matchesFilter(row.assetId, where.assetId)) return false;
              if (!matchesFilter(row.bookingId, where.bookingId)) return false;
              // The reserved-rows read filters `assetKitId: null` (standalone
              // only); the checked-out reads omit it (all slices).
              if (where.assetKitId === null && row.assetKitId !== null) {
                return false;
              }
              if (where.booking) {
                const booking = bookingById.get(row.bookingId);
                if (!booking) return false;
                if (!matchesFilter(booking.status, where.booking.status))
                  return false;
                if (
                  where.booking.organizationId &&
                  booking.organizationId !== where.booking.organizationId
                ) {
                  return false;
                }
              }
              return true;
            })
            .map((row) => ({
              id: row.id,
              assetId: row.assetId,
              bookingId: row.bookingId,
              quantity: row.quantity,
              assetKitId: row.assetKitId,
              // Neither formula under test reads `booking.from`/`.to` for the
              // checked-out computation (that's only consulted by the
              // `reserved` side of `getAssetAvailabilityBatch`, which this
              // suite calls with `window: null`).
              booking: null,
            }))
      ),
    },
    booking: {
      findUnique: vitest.fn(({ where }: { where: { id: string } }) => {
        const booking = bookingById.get(where.id);
        return booking ? { status: booking.status } : null;
      }),
    },
    partialBookingCheckout: {
      findMany: vitest.fn(
        ({ where }: { where: { bookingId?: ScalarFilter } }) =>
          fixture.sessions
            .filter((s) => matchesFilter(s.bookingId, where.bookingId))
            .map((s) => ({
              bookingId: s.bookingId,
              assetIds: s.assetIds,
              quantities: s.quantities,
              bookingAssetIds: s.bookingAssetIds,
            }))
      ),
    },
  };
}

describe("getAssetAvailabilityBatch vs computeCheckedOutForAsset (real implementations)", () => {
  it("agree on a legacy all-at-once checkout (zero PartialBookingCheckout sessions)", async () => {
    const client = createFakeClient({
      bookingAssets: [{ assetId: "a1", bookingId: "legacy", quantity: 5 }],
      bookings: [
        { id: "legacy", status: BookingStatus.ONGOING, organizationId: ORG_ID },
      ],
      sessions: [],
    });

    const real = await computeCheckedOutForAsset(client, "a1", ORG_ID);
    const batch = await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client as unknown as AvailabilityBatchClient,
    });

    expect(real).toBe(5);
    expect(batch.get("a1")?.checkedOut).toBe(real);
  });

  it("agree on a partial checkout (booked minus claimed remains on the shelf)", async () => {
    const client = createFakeClient({
      bookingAssets: [{ assetId: "a1", bookingId: "partial", quantity: 8 }],
      bookings: [
        {
          id: "partial",
          status: BookingStatus.OVERDUE,
          organizationId: ORG_ID,
        },
      ],
      sessions: [
        {
          bookingId: "partial",
          assetIds: ["a1"],
          quantities: [3],
          bookingAssetIds: [""],
        },
      ],
    });

    const real = await computeCheckedOutForAsset(client, "a1", ORG_ID);
    const batch = await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client as unknown as AvailabilityBatchClient,
    });

    expect(real).toBe(3);
    expect(batch.get("a1")?.checkedOut).toBe(real);
  });

  it("agree on multiple active bookings for one asset (legacy + partial summed)", async () => {
    const client = createFakeClient({
      bookingAssets: [
        { assetId: "a1", bookingId: "legacy", quantity: 5 },
        { assetId: "a1", bookingId: "partial", quantity: 8 },
      ],
      bookings: [
        { id: "legacy", status: BookingStatus.ONGOING, organizationId: ORG_ID },
        {
          id: "partial",
          status: BookingStatus.OVERDUE,
          organizationId: ORG_ID,
        },
      ],
      sessions: [
        {
          bookingId: "partial",
          assetIds: ["a1"],
          quantities: [3],
          bookingAssetIds: [""],
        },
      ],
    });

    const real = await computeCheckedOutForAsset(client, "a1", ORG_ID);
    const batch = await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client as unknown as AvailabilityBatchClient,
    });

    // legacy: booked 5, 0 sessions → fully checked out → 5
    // partial: booked 8, claimed 3 → remaining 5 → checked out 3
    expect(real).toBe(8);
    expect(batch.get("a1")?.checkedOut).toBe(real);
  });

  it("agree across multiple assets sharing bookings in one batch call", async () => {
    // A second asset on the SAME bookings, with a different split, proves
    // the batch's per-(booking, asset) grouping doesn't cross-contaminate
    // between assets sharing a booking.
    const client = createFakeClient({
      bookingAssets: [
        { assetId: "a1", bookingId: "legacy", quantity: 5 },
        { assetId: "a2", bookingId: "legacy", quantity: 2 },
        { assetId: "a1", bookingId: "partial", quantity: 8 },
        { assetId: "a2", bookingId: "partial", quantity: 4 },
      ],
      bookings: [
        { id: "legacy", status: BookingStatus.ONGOING, organizationId: ORG_ID },
        {
          id: "partial",
          status: BookingStatus.OVERDUE,
          organizationId: ORG_ID,
        },
      ],
      sessions: [
        {
          bookingId: "partial",
          assetIds: ["a1", "a2"],
          quantities: [3, 1],
          bookingAssetIds: ["", ""],
        },
      ],
    });

    const real1 = await computeCheckedOutForAsset(client, "a1", ORG_ID);
    const real2 = await computeCheckedOutForAsset(client, "a2", ORG_ID);
    const batch = await getAssetAvailabilityBatch(["a1", "a2"], {
      organizationId: ORG_ID,
      window: null,
      db: client as unknown as AvailabilityBatchClient,
    });

    expect(batch.get("a1")?.checkedOut).toBe(real1);
    expect(batch.get("a2")?.checkedOut).toBe(real2);
  });

  // #2790 ③: a QT asset checked out ENTIRELY via a kit must not have its
  // kit-driven checked-out units subtracted twice in `physicalAvailable`
  // (once via `inKits`, once via `checkedOut`). Before the fix this asset
  // showed `physicalAvailable === -10`.
  it("kit-only checkout: physicalAvailable stays non-negative while checkedOut is the full count", async () => {
    const client = createFakeClient({
      // total 10, fully allocated into one kit (inKits = 10).
      assets: [{ id: "a1", quantity: 10 }],
      assetKits: [{ assetId: "a1", quantity: 10 }],
      // One kit-driven slice (assetKitId set), qty 10, no standalone slice.
      bookingAssets: [
        {
          id: "ba-kit",
          assetId: "a1",
          bookingId: "b1",
          quantity: 10,
          assetKitId: "kit1",
        },
      ],
      bookings: [
        { id: "b1", status: BookingStatus.ONGOING, organizationId: ORG_ID },
      ],
      // Legacy all-at-once checkout (zero sessions) → all 10 units off the shelf.
      sessions: [],
    });

    const real = await computeCheckedOutForAsset(client, "a1", ORG_ID);
    const batch = await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client as unknown as AvailabilityBatchClient,
    });

    const a1 = batch.get("a1");
    // Displayed "Checked out" is the FULL count (kit + standalone), unchanged.
    expect(real).toBe(10);
    expect(a1?.checkedOut).toBe(10);
    // physicalAvailable = 10 − 0(custody) − 10(inKits) − 0(standaloneCheckedOut)
    // = 0. Was −10 before the fix (full 10 subtracted on top of inKits).
    expect(a1?.inKits).toBe(10);
    expect(a1?.physicalAvailable).toBe(0);
  });

  // #2790 ③: a QT asset with BOTH a standalone free-pool slice and a kit-driven
  // slice on the same booking. Only the standalone checked-out units feed
  // `physicalAvailable`; the displayed `checkedOut` is still the full sum.
  it("mixed standalone + kit: only standalone checked-out feeds physicalAvailable", async () => {
    const client = createFakeClient({
      // total 20, kit membership qty 5 (inKits = 5).
      assets: [{ id: "a1", quantity: 20 }],
      assetKits: [{ assetId: "a1", quantity: 5 }],
      // One ONGOING booking with a standalone slice (qty 8) + a kit-driven
      // slice (qty 5). 10 units are claimed untagged → standalone-first greedy
      // gives standalone 8, kit 2.
      bookingAssets: [
        { id: "ba-standalone", assetId: "a1", bookingId: "b1", quantity: 8 },
        {
          id: "ba-kit",
          assetId: "a1",
          bookingId: "b1",
          quantity: 5,
          assetKitId: "kit1",
        },
      ],
      bookings: [
        { id: "b1", status: BookingStatus.ONGOING, organizationId: ORG_ID },
      ],
      sessions: [
        {
          bookingId: "b1",
          assetIds: ["a1"],
          quantities: [10],
          bookingAssetIds: [""],
        },
      ],
    });

    const real = await computeCheckedOutForAsset(client, "a1", ORG_ID);
    const batch = await getAssetAvailabilityBatch(["a1"], {
      organizationId: ORG_ID,
      window: null,
      db: client as unknown as AvailabilityBatchClient,
    });

    const a1 = batch.get("a1");
    // Full checked-out = standalone(8) + kit(2) = 10 — the displayed number.
    expect(real).toBe(10);
    expect(a1?.checkedOut).toBe(10);
    // physicalAvailable = 20 − 0 − 5(inKits) − 8(standaloneCheckedOut) = 7.
    expect(a1?.inKits).toBe(5);
    expect(a1?.physicalAvailable).toBe(7);
  });
});
