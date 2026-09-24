/**
 * Unit tests for `adjustQuantity`'s STOCK-LOWERING guard wiring
 * (`consumption-log/service.server.ts`).
 *
 * The guard's own committed-peak math (custody + kits + peak-concurrent
 * overlapping bookings, the bb1/bb2 non-overlap property, query-count
 * bounds, etc.) is exhaustively unit-tested in
 * `~/modules/asset/availability.server.test.ts`. This file only verifies
 * that `adjustQuantity` WIRES the guard correctly on a `subtract`:
 *   - it's called with the post-subtraction total, inside the same tx,
 *     behind the row lock;
 *   - its rejection propagates as-is (no write occurs);
 *   - it's never called for `add` (RESTOCK) — an increase can never violate
 *     a below-committed rule.
 *
 * @see {@link file://./service.server.ts} — the module under test
 * @see {@link file://../asset/availability.server.ts} — the guard's own logic + tests
 */
import { ConsumptionCategory } from "@prisma/client";
import { describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

// why: the guard's committed-peak math is already exhaustively unit-tested
// in `asset/availability.server.test.ts`. Stubbing it here isolates
// `adjustQuantity`'s WIRING (call args, ordering, error propagation) from
// having to re-derive custody/kit/booking fixtures in this file too.
const assertAssetQuantityNotBelowReservationsMock = vitest.fn();
// `adjustQuantity` imports the guard from the dependency-free leaf (not
// `availability.server`) to avoid an import cycle — mock the leaf so the stub
// actually intercepts.
vitest.mock("~/modules/asset/availability-primitives.server", () => ({
  assertAssetQuantityNotBelowReservations: (...args: unknown[]) =>
    assertAssetQuantityNotBelowReservationsMock(...args),
}));

// why: lockAssetForQuantityUpdate runs a raw `SELECT ... FOR UPDATE` that
// cannot execute against a mocked tx — stub it to return a controlled,
// already-locked Asset row.
const lockAssetForQuantityUpdateMock = vitest.fn();
vitest.mock("./quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: (...args: unknown[]) =>
    lockAssetForQuantityUpdateMock(...args),
}));

// why: isolating adjustQuantity from real database operations. `$transaction`
// routes its callback through this same mocked `db` object so inner `tx.*`
// calls hit the stubs below (mirrors `asset/service.server.test.ts`'s
// convention for interactive-transaction mocking).
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest
      .fn()
      .mockImplementation((callback: (tx: unknown) => unknown) => callback(db)),
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    asset: {
      update: vitest.fn().mockResolvedValue({}),
    },
    consumptionLog: {
      create: vitest.fn().mockResolvedValue({}),
    },
    // why: `adjustQuantity` now emits an `ASSET_QUANTITY_CHANGED` activity
    // event via `recordEvent` inside the same tx (audit trail). `recordEvent`
    // resolves the actor snapshot (`user.findUnique`) then writes the row
    // (`activityEvent.create`); both run against this mocked `tx` (= `db`), so
    // they must exist or every adjust would throw.
    activityEvent: {
      create: vitest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    // why: a subtract also runs `assertStockNotBelowManualPlacements`, which
    // reads the asset's manual placement rows. Default to none so the existing
    // subtract scenarios stay about the reservations guard.
    assetLocation: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
  },
}));

// why: `vitest.mock` calls above are hoisted above all imports by Vitest's
// transform regardless of source position, so importing the module under
// test here (after the mocks are declared) is only for readability.
import { adjustQuantity } from "./service.server";

const ASSET_ID = "asset-1";
const ORG_ID = "org-1";
const USER_ID = "user-1";

/** A fresh, fully-locked QUANTITY_TRACKED asset row, as `lockAssetForQuantityUpdate` returns it. */
function lockedAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    organizationId: ORG_ID,
    type: "QUANTITY_TRACKED",
    quantity: 10,
    title: "Widget",
    unitOfMeasure: "boards",
    ...overrides,
  };
}

function resetMocks() {
  vitest.clearAllMocks();
  lockAssetForQuantityUpdateMock.mockResolvedValue(lockedAsset());
  assertAssetQuantityNotBelowReservationsMock.mockResolvedValue(undefined);
  // @ts-expect-error mocked
  db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
  // @ts-expect-error mocked
  db.asset.update.mockResolvedValue({ id: ASSET_ID, quantity: 7 });
  // @ts-expect-error mocked
  db.assetLocation.findMany.mockResolvedValue([]);
}

describe("adjustQuantity — stock-lowering guard wiring", () => {
  it("calls the guard with the post-subtraction total on a subtract", async () => {
    resetMocks();

    await adjustQuantity({
      assetId: ASSET_ID,
      quantity: 3,
      category: ConsumptionCategory.ADJUSTMENT,
      direction: "subtract",
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    // current 10 − 3 = 7
    expect(assertAssetQuantityNotBelowReservationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        newTotal: 7,
        assetTitle: "Widget",
        unitOfMeasure: "boards",
      })
    );
    // Threaded the tx, not the untransacted global — same object here since
    // the mocked `$transaction` routes its callback through `db` itself.
    expect(
      assertAssetQuantityNotBelowReservationsMock.mock.calls[0][0].tx
    ).toBe(db);
  });

  it("rejects with the guard's 400 and never writes when the new total would drop below commitments", async () => {
    resetMocks();
    assertAssetQuantityNotBelowReservationsMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          'Cannot reduce "Widget" to 2 boards — 5 boards are committed ' +
          "(custody, kits, or overlapping bookings). Release or reduce those first.",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    await expect(
      adjustQuantity({
        assetId: ASSET_ID,
        quantity: 8,
        category: ConsumptionCategory.ADJUSTMENT,
        direction: "subtract",
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      message: expect.stringContaining("committed"),
    });

    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.consumptionLog.create).not.toHaveBeenCalled();
  });

  it("refuses a subtraction that would strand units already placed at locations", async () => {
    // The location axis has its own `sum <= Asset.quantity` invariant and no
    // trigger fires on an `Asset` write, so this is the only thing standing
    // between a typed-down total and a silently over-allocated location.
    resetMocks();
    // @ts-expect-error mocked
    db.assetLocation.findMany.mockResolvedValue([
      { id: "al-1", locationId: "loc-1", quantity: 9 },
    ]);

    await expect(
      adjustQuantity({
        assetId: ASSET_ID,
        quantity: 3,
        category: ConsumptionCategory.ADJUSTMENT,
        direction: "subtract",
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("assigned to locations"),
    });

    expect(db.asset.update).not.toHaveBeenCalled();
    expect(db.consumptionLog.create).not.toHaveBeenCalled();
  });

  it("allows a subtraction the unplaced residual covers", async () => {
    resetMocks();
    // 10 owned, 5 placed, subtract 3 → 7 total still covers the 5 placed.
    // @ts-expect-error mocked
    db.assetLocation.findMany.mockResolvedValue([
      { id: "al-1", locationId: "loc-1", quantity: 5 },
    ]);

    await expect(
      adjustQuantity({
        assetId: ASSET_ID,
        quantity: 3,
        category: ConsumptionCategory.ADJUSTMENT,
        direction: "subtract",
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).resolves.toMatchObject({ id: ASSET_ID });
  });

  it("allows a safe subtraction that stays at or above what's committed", async () => {
    resetMocks();

    await expect(
      adjustQuantity({
        assetId: ASSET_ID,
        quantity: 2,
        category: ConsumptionCategory.LOSS,
        direction: "subtract",
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).resolves.toMatchObject({ id: ASSET_ID });

    expect(db.asset.update).toHaveBeenCalled();
  });

  it("never calls the guard for an add (RESTOCK) — an increase can't violate a below-committed rule", async () => {
    resetMocks();

    await adjustQuantity({
      assetId: ASSET_ID,
      quantity: 5,
      category: ConsumptionCategory.RESTOCK,
      direction: "add",
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(assertAssetQuantityNotBelowReservationsMock).not.toHaveBeenCalled();
    expect(db.asset.update).toHaveBeenCalled();
  });

  it("emits an ASSET_QUANTITY_CHANGED event with the true direction alongside the ConsumptionLog on a subtract", async () => {
    resetMocks();

    await adjustQuantity({
      assetId: ASSET_ID,
      quantity: 3,
      category: ConsumptionCategory.ADJUSTMENT,
      direction: "subtract",
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    // The direction-agnostic ConsumptionLog stores the positive delta (3)…
    expect(db.consumptionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 3 }),
      })
    );
    // …while the activity event captures the true 10 → 7 decrease.
    expect(db.activityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ASSET_QUANTITY_CHANGED",
          entityType: "ASSET",
          entityId: ASSET_ID,
          assetId: ASSET_ID,
          field: "quantity",
          fromValue: 10,
          toValue: 7,
        }),
      })
    );
  });

  it("emits ASSET_QUANTITY_CHANGED capturing the increase on an add (RESTOCK)", async () => {
    resetMocks();

    await adjustQuantity({
      assetId: ASSET_ID,
      quantity: 5,
      category: ConsumptionCategory.RESTOCK,
      direction: "add",
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    // current 10 + 5 = 15
    expect(db.activityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ASSET_QUANTITY_CHANGED",
          field: "quantity",
          fromValue: 10,
          toValue: 15,
        }),
      })
    );
  });

  it("still enforces the existing custody-only check before ever reaching the fuller guard", async () => {
    resetMocks();
    // inCustody 6 on a current total of 10 → maxRemovable 4. Requesting to
    // remove 5 trips the Step-4 custody-only guard first — the fuller
    // committed-peak guard (kits/bookings included) is never reached.
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 6 } });

    await expect(
      adjustQuantity({
        assetId: ASSET_ID,
        quantity: 5,
        category: ConsumptionCategory.ADJUSTMENT,
        direction: "subtract",
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(assertAssetQuantityNotBelowReservationsMock).not.toHaveBeenCalled();
  });
});
