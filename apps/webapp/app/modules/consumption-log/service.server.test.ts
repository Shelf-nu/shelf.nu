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
