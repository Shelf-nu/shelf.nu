/**
 * Route tests for `bookings.$bookingId.adjust-asset-quantity` — the
 * per-asset "Adjust quantity" action for a QUANTITY_TRACKED booking row.
 *
 * Lives in `test/routes-tests/` (never under `app/routes/`): the dev server
 * warms every file under `app/routes/` as a CLIENT module, so a co-located
 * route test importing a `*.server` module breaks `pnpm webapp:dev`. Enforced
 * by the `local-rules/no-test-files-in-routes` ESLint rule.
 *
 * The `.availability` infix distinguishes this from
 * `bookings.$bookingId.adjust-asset-quantity.test.ts` (the ownership/IDOR
 * guard) — both cover the same route from different angles.
 *
 * These tests cover the #2725 fix: the guard used to compare the absolute
 * submitted quantity against an unwindowed, unclamped availability figure,
 * so once a pool became globally over-committed, even SUBMITTING A
 * REDUCTION threw "Only -N available." and the booking could never be
 * edited back down. The route now delegates to the shared directional,
 * windowed guard, `assertAssetQuantityAvailable`
 * (`~/modules/asset/availability.server`), which is imported for real here
 * (not mocked) — only its DB-facing collaborators are stubbed — so these
 * tests exercise the actual route → guard wiring, not a re-implementation
 * of the guard's logic (which has its own unit coverage in
 * `availability.server.test.ts`).
 *
 * Mock shape mirrors `availability.server.test.ts`: modules are mocked
 * with inline factories (no outer-scope variable references, which Vitest
 * cannot safely hoist), then the mocked exports are imported and
 * configured per-test with `// @ts-expect-error mocked` — the same
 * convention used there.
 *
 * @see {@link file://../../../app/routes/api+/bookings.$bookingId.adjust-asset-quantity.ts}
 * @see {@link file://../../../app/modules/asset/availability.server.ts}
 * @see {@link file://../../../app/modules/asset/availability.server.test.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { computeCheckedOutBreakdownForAsset } from "~/modules/booking/checked-out.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { computeAvailableQuantity } from "~/modules/consumption-log/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { requirePermission } from "~/utils/roles.server";

/* -------------------------------------------------------------------------- */
/*                                  Mocks                                     */
/* -------------------------------------------------------------------------- */

// why: isolates the route from real Postgres. `bookingAsset.findFirst`
// returns the fixture row built per-test; `$transaction` routes its
// callback through a hand-built `tx` mock (see `createTxMock` below) that
// stands in for the interactive Prisma transaction client.
vitest.mock("~/database/db.server", () => ({
  db: {
    bookingAsset: { findFirst: vitest.fn() },
    $transaction: vitest.fn(),
  },
}));

// why: bypasses the real org/RBAC lookup (org membership resolution, role
// permission matrix) — out of scope for this test, which targets the
// availability-guard wiring, not authorization.
vitest.mock("~/utils/roles.server", () => ({
  requirePermission: vitest.fn(),
}));

// why: the activity-note + notification side effects are best-effort
// (wrapped in their own try/catch in the route) and unrelated to the
// guard behaviour under test; stub them to keep assertions focused and
// avoid noisy unmocked-module errors.
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn(),
}));
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn(),
}));
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn(),
}));
vitest.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vitest.fn(),
}));

// why: `assertAssetQuantityAvailable` composes `getAssetAvailability`,
// which in turn calls these two collaborators to compute `total`,
// `inCustody`, and `checkedOut`. Stubbing them — same approach as
// `availability.server.test.ts` — lets each test control those figures
// via fixture data instead of a live DB, while every reservation/kit read
// the guard performs still goes through this route's own `tx` mock, so
// the windowed peak-concurrent math runs for real.
vitest.mock("~/modules/consumption-log/service.server", () => ({
  computeAvailableQuantity: vitest.fn(),
}));
vitest.mock("~/modules/booking/checked-out.server", () => ({
  computeCheckedOutBreakdownForAsset: vitest.fn(),
}));

// why: `vitest.mock` calls above are hoisted above all imports by Vitest's
// transform regardless of source position, so importing the module under
// test here (after the mocks are declared) is only for readability.
import { action } from "~/routes/api+/bookings.$bookingId.adjust-asset-quantity";

/* -------------------------------------------------------------------------- */
/*                                 Fixtures                                   */
/* -------------------------------------------------------------------------- */

const ORG_ID = "org-1";
const USER_ID = "user-1";
const BOOKING_ID = "booking-1";
const ASSET_ID = "asset-1";
const BOOKING_ASSET_ID = "booking-asset-1";

/** A committed reservation row as returned by `tx.bookingAsset.findMany` inside `getAssetAvailability`. */
type ReservedRowFixture = {
  bookingId: string;
  quantity: number;
  booking: { from: Date; to: Date } | null;
};

/**
 * Builds the `tx` mock passed into `db.$transaction`'s callback. Shaped
 * like `PrismaClientOrTx` (`~/modules/asset/availability.server`) plus
 * `$queryRaw` (consumed by `lockAssetForQuantityUpdate`'s row lock),
 * `bookingAsset.findUnique` (the route's TOCTOU re-read of the booked
 * quantity UNDER the lock) and `bookingAsset.update` (the route's own
 * write), so the REAL `assertAssetQuantityAvailable` → `getAssetAvailability`
 * composition runs unmodified against the reservation rows supplied per test.
 *
 * `currentQuantity` is the value the locked re-read observes — the directional
 * guard measures increases against THIS, not the outside-tx snapshot. Defaults
 * to the fixture's own quantity for the common no-race case; tests modelling a
 * concurrent change set it to the post-race value.
 */
function createTxMock({
  inKits = 0,
  reservedRows = [],
  currentQuantity = 0,
}: {
  inKits?: number;
  reservedRows?: ReservedRowFixture[];
  currentQuantity?: number;
} = {}) {
  return {
    $queryRaw: vitest.fn().mockResolvedValue([{ id: ASSET_ID }]),
    assetKit: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: inKits } }),
    },
    bookingAsset: {
      findMany: vitest.fn().mockResolvedValue(reservedRows),
      findUnique: vitest.fn().mockResolvedValue({ quantity: currentQuantity }),
      update: vitest.fn().mockResolvedValue({}),
    },
    consumptionLog: { groupBy: vitest.fn().mockResolvedValue([]) },
  };
}

/** Builds the `BookingAsset` row `db.bookingAsset.findFirst` resolves to. */
function buildBookingAssetFixture({
  quantity,
  from = new Date("2026-08-01T09:00:00.000Z"),
  to = new Date("2026-08-05T09:00:00.000Z"),
  unitOfMeasure = null,
}: {
  quantity: number;
  from?: Date;
  to?: Date;
  unitOfMeasure?: string | null;
}) {
  return {
    id: BOOKING_ASSET_ID,
    quantity,
    assetId: ASSET_ID,
    bookingId: BOOKING_ID,
    asset: {
      id: ASSET_ID,
      title: "Folding Chair",
      type: "QUANTITY_TRACKED",
      unitOfMeasure,
    },
    booking: {
      id: BOOKING_ID,
      name: "Summer Conference",
      creatorId: USER_ID,
      custodianUserId: null,
      from,
      to,
    },
  };
}

/** Builds a POST `Request` carrying the adjust-quantity form payload. */
function buildRequest(body: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(body)) {
    formData.append(key, value);
  }
  return new Request(
    `http://localhost/api/bookings/${BOOKING_ID}/adjust-asset-quantity`,
    { method: "POST", body: formData }
  );
}

/** Builds the `ActionFunctionArgs` the route's `action` export expects. */
function buildActionArgs(body: Record<string, string>): ActionFunctionArgs {
  return {
    context: { getSession: () => ({ userId: USER_ID }) },
    request: buildRequest(body),
    params: { bookingId: BOOKING_ID },
  } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vitest.clearAllMocks();
  // @ts-expect-error mocked
  requirePermission.mockResolvedValue({
    organizationId: ORG_ID,
    role: "ADMIN",
    isSelfServiceOrBase: false,
  });
  // @ts-expect-error mocked
  getUserByID.mockResolvedValue({
    id: USER_ID,
    firstName: "Nik",
    lastName: "B",
    displayName: "Nik B",
  });
  // @ts-expect-error mocked
  createNotes.mockResolvedValue(undefined);
  // @ts-expect-error mocked
  createSystemBookingNote.mockResolvedValue(undefined);
  // @ts-expect-error mocked
  sendNotification.mockReturnValue(undefined);
  // @ts-expect-error mocked
  computeCheckedOutBreakdownForAsset.mockResolvedValue({
    total: 0,
    standalone: 0,
  });
});

/* -------------------------------------------------------------------------- */
/*                                   Tests                                    */
/* -------------------------------------------------------------------------- */

describe("action (adjust-asset-quantity)", () => {
  it("allows reducing an over-reserved QT asset even when the pool is negative (#2725)", async () => {
    // Current row already holds 8 units. Two OTHER bookings concurrently
    // reserve 8 units each, overlapping the current booking's window —
    // peak-concurrent reserved = 16, so physicalAvailable(10) - reserved(16)
    // = a negative `bookable`. Before the fix, comparing the absolute
    // submitted quantity against this negative availability threw even for
    // a reduction. Submitting 1 (< current 8) must now succeed.
    const bookingAsset = buildBookingAssetFixture({ quantity: 8 });
    // @ts-expect-error mocked
    db.bookingAsset.findFirst.mockResolvedValue(bookingAsset);
    // @ts-expect-error mocked
    computeAvailableQuantity.mockResolvedValue({ total: 10, inCustody: 0 });

    const tx = createTxMock({
      currentQuantity: 8,
      reservedRows: [
        {
          bookingId: "other-booking-1",
          quantity: 8,
          booking: {
            from: new Date("2026-08-01T09:00:00.000Z"),
            to: new Date("2026-08-05T09:00:00.000Z"),
          },
        },
        {
          bookingId: "other-booking-2",
          quantity: 8,
          booking: {
            from: new Date("2026-08-02T09:00:00.000Z"),
            to: new Date("2026-08-04T09:00:00.000Z"),
          },
        },
      ],
    });
    // @ts-expect-error mocked
    db.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(tx)
    );

    const response = await action(
      buildActionArgs({ assetId: ASSET_ID, quantity: "1" })
    );

    expect(response.data.error).toBeNull();
    if (response.data.error !== null) throw new Error("expected success");
    expect(response.data.success).toBe(true);

    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ASSET_ID },
      data: { quantity: 1 },
    });
    // The directional guard short-circuits on `increase <= 0` and never
    // reads availability at all for a pure reduction — assert the
    // reservation query never ran, documenting the short-circuit.
    expect(tx.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("rejects an increase beyond windowed availability with the standardized message", async () => {
    // physicalAvailable = total(10) - inCustody(0) - inKits(0) - checkedOut(0) = 10.
    // One other booking overlaps the full window reserving 7 units, so
    // bookable = 10 - 7 = 3. Current row quantity = 2, requested = 8, so the
    // increase (6) exceeds bookable (3) and must be rejected. The message's
    // `available` figure is the ABSOLUTE `bookable` (3) — the max this booking
    // may hold — not `currentQuantity + bookable`.
    const bookingAsset = buildBookingAssetFixture({
      quantity: 2,
      unitOfMeasure: null,
    });
    // @ts-expect-error mocked
    db.bookingAsset.findFirst.mockResolvedValue(bookingAsset);
    // @ts-expect-error mocked
    computeAvailableQuantity.mockResolvedValue({ total: 10, inCustody: 0 });

    const tx = createTxMock({
      currentQuantity: 2,
      reservedRows: [
        {
          bookingId: "other-booking-1",
          quantity: 7,
          booking: {
            from: new Date("2026-08-01T09:00:00.000Z"),
            to: new Date("2026-08-05T09:00:00.000Z"),
          },
        },
      ],
    });
    // @ts-expect-error mocked
    db.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(tx)
    );

    const response = await action(
      buildActionArgs({ assetId: ASSET_ID, quantity: "8" })
    );

    expect(response.data.error).not.toBeNull();
    if (response.data.error === null) throw new Error("expected a 400 error");
    // bookable = 10 total − 7 reserved by the other overlapping booking = 3,
    // the ABSOLUTE max this booking may hold (not current + bookable).
    expect(response.data.error.message).toBe(
      "Only 3 of 10 units available in this window — reduce the quantity to continue."
    );
    expect(response.init?.status).toBe(400);
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("passes for a same-quantity resubmission (no-op)", async () => {
    const bookingAsset = buildBookingAssetFixture({ quantity: 5 });
    // @ts-expect-error mocked
    db.bookingAsset.findFirst.mockResolvedValue(bookingAsset);
    // @ts-expect-error mocked
    computeAvailableQuantity.mockResolvedValue({ total: 10, inCustody: 0 });

    const tx = createTxMock({ currentQuantity: 5 });
    // @ts-expect-error mocked
    db.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(tx)
    );

    const response = await action(
      buildActionArgs({ assetId: ASSET_ID, quantity: "5" })
    );

    expect(response.data.error).toBeNull();
    if (response.data.error !== null) throw new Error("expected success");
    expect(response.data.success).toBe(true);

    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ASSET_ID },
      data: { quantity: 5 },
    });
    // increase = 5 - 5 = 0 → the directional guard's "reductions & no-ops
    // always allowed" early return; no availability read should occur.
    expect(tx.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("re-reads the booked quantity under the lock so a stale-high snapshot can't slip an increase past the guard (TOCTOU)", async () => {
    // Outside-tx snapshot reports 8 units, but a concurrent request already
    // reduced the real booked qty to 2 before this request took the lock.
    // Submitting 6 looks like a REDUCTION against the stale 8 (6 <= 8, which
    // the directional guard would wave through), but is actually a +4 INCREASE
    // against the committed 2. With one other booking reserving 7 of the 10,
    // bookable = 3, so the real increase (4) must be REJECTED. Before the
    // re-read fix, the stale snapshot let this oversubscribe the pool.
    const bookingAsset = buildBookingAssetFixture({ quantity: 8 });
    // @ts-expect-error mocked
    db.bookingAsset.findFirst.mockResolvedValue(bookingAsset);
    // @ts-expect-error mocked
    computeAvailableQuantity.mockResolvedValue({ total: 10, inCustody: 0 });

    const tx = createTxMock({
      currentQuantity: 2, // the FRESH value observed under the lock
      reservedRows: [
        {
          bookingId: "other-booking-1",
          quantity: 7,
          booking: {
            from: new Date("2026-08-01T09:00:00.000Z"),
            to: new Date("2026-08-05T09:00:00.000Z"),
          },
        },
      ],
    });
    // @ts-expect-error mocked
    db.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(tx)
    );

    const response = await action(
      buildActionArgs({ assetId: ASSET_ID, quantity: "6" })
    );

    // Measured against the fresh 2, the +4 increase exceeds bookable (3).
    expect(response.data.error).not.toBeNull();
    if (response.data.error === null) throw new Error("expected a 400 error");
    expect(response.init?.status).toBe(400);
    // The re-read ran, the availability guard ran (not short-circuited as a
    // reduction against the stale 8), and the write did NOT happen.
    expect(tx.bookingAsset.findUnique).toHaveBeenCalledWith({
      where: { id: BOOKING_ASSET_ID },
      select: { quantity: true },
    });
    expect(tx.bookingAsset.findMany).toHaveBeenCalled();
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });
});
