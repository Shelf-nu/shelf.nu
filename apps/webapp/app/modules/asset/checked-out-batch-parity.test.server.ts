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
import { computeCheckedOutForAsset } from "~/modules/booking/service.server";
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
  assetId: string;
  bookingId: string;
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
 * `computeCheckedOutForAsset` / `computeBookingAssetsRemainingToCheckOut`
 * need — driven by the SAME fixture rows, so both real implementations read
 * identical underlying data. `asset`/`custody`/`assetKit`/`consumptionLog`
 * are stubbed to empty results: this suite only compares `checkedOut`, which
 * never touches them.
 *
 * @param fixture - The booking-assets, bookings, and checkout sessions both
 *   formulas under test will query.
 */
function createFakeClient(fixture: {
  bookingAssets: FixtureBookingAsset[];
  bookings: FixtureBooking[];
  sessions: FixtureSession[];
}) {
  const bookingById = new Map(fixture.bookings.map((b) => [b.id, b]));

  return {
    asset: { findMany: vitest.fn().mockResolvedValue([]) },
    custody: { groupBy: vitest.fn().mockResolvedValue([]) },
    assetKit: { groupBy: vitest.fn().mockResolvedValue([]) },
    consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
    bookingAsset: {
      findMany: vitest.fn(
        ({
          where,
        }: {
          where: {
            assetId?: ScalarFilter;
            bookingId?: ScalarFilter;
            booking?: { status?: ScalarFilter; organizationId?: string };
          };
        }) =>
          fixture.bookingAssets
            .filter((row) => {
              if (!matchesFilter(row.assetId, where.assetId)) return false;
              if (!matchesFilter(row.bookingId, where.bookingId)) return false;
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
              assetId: row.assetId,
              bookingId: row.bookingId,
              quantity: row.quantity,
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
});
