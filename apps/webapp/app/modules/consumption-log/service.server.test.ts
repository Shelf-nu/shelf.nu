/**
 * Behavior tests for `adjustQuantity`'s activity-event emission.
 *
 * The Quick Adjust dialog is the primary way workspace stock actually moves,
 * yet `ASSET_QUANTITY_CHANGED` used to be emitted ONLY by `updateAsset`
 * (asset edit form + CSV import). The "Quantity changed" row in the Asset
 * Activity report therefore told a partial truth — it silently omitted every
 * Quick Adjust. These tests lock the emission, its in-transaction placement,
 * and the from→to values coming from the ROW-LOCKED read.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../reports/helpers.server.ts} — the report that consumes the event
 */

import { AssetType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi, vitest } from "vitest";
import { recordEvent } from "~/modules/activity-event/service.server";
import { lockAssetForQuantityUpdate } from "./quantity-lock.server";
import { adjustQuantity } from "./service.server";

/**
 * Single tx client handed to the `$transaction` callback, so assertions can
 * prove the event was written through the SAME client as the mutation.
 */
const tx = {
  asset: { update: vitest.fn() },
  custody: { aggregate: vitest.fn() },
  consumptionLog: { create: vitest.fn() },
};

// why: `adjustQuantity` is an interactive transaction over a locked row.
// Running it against a real DB would need a migrated Postgres; passing our
// own `tx` object into the callback is what lets us assert that the event is
// recorded through the transaction client (atomic with the write) rather
// than the ambient client.
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn(
      (callback: (client: typeof tx) => unknown) => callback(tx) as unknown
    ),
  },
}));

// why: the lock is raw `SELECT ... FOR UPDATE` SQL — unrunnable without a
// real Postgres. Stubbing it lets each test declare the exact under-lock
// stock value the event's `fromValue` must be derived from.
vitest.mock("./quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn(),
}));

// why: the unit under test is WHICH event is emitted with WHICH payload —
// not the ActivityEvent row writer (covered by the activity-event suite).
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
}));

const organizationId = "org-1";
const userId = "user-1";
const assetId = "asset-1";

/** Row-locked asset shape `lockAssetForQuantityUpdate` resolves to. */
function lockedAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId,
    organizationId,
    type: AssetType.QUANTITY_TRACKED,
    quantity: 100,
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof lockAssetForQuantityUpdate>>;
}

beforeEach(() => {
  vitest.clearAllMocks();
  vi.mocked(lockAssetForQuantityUpdate).mockResolvedValue(lockedAsset());
  tx.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
  tx.asset.update.mockResolvedValue({ id: assetId });
  tx.consumptionLog.create.mockResolvedValue({ id: "log-1" });
});

describe("adjustQuantity — ASSET_QUANTITY_CHANGED emission", () => {
  it("emits the event for a stock-reducing adjustment", async () => {
    await adjustQuantity({
      assetId,
      quantity: 40,
      category: "LOSS",
      direction: "subtract",
      userId,
      organizationId,
    });

    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith(
      {
        organizationId,
        actorUserId: userId,
        action: "ASSET_QUANTITY_CHANGED",
        entityType: "ASSET",
        entityId: assetId,
        assetId,
        field: "quantity",
        fromValue: 100,
        toValue: 60,
      },
      // Same transaction client as the write — the event cannot survive a
      // rollback of the quantity update.
      tx
    );
  });

  it("emits the event for a RESTOCK (stock-increasing) adjustment", async () => {
    await adjustQuantity({
      assetId,
      quantity: 25,
      category: "RESTOCK",
      direction: "add",
      userId,
      organizationId,
    });

    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordEvent).mock.calls[0][0]).toMatchObject({
      action: "ASSET_QUANTITY_CHANGED",
      fromValue: 100,
      toValue: 125,
    });
  });

  it("derives fromValue from the ROW-LOCKED read, not a caller snapshot", async () => {
    // A concurrent writer committed 100 → 70 before we took the lock.
    vi.mocked(lockAssetForQuantityUpdate).mockResolvedValue(
      lockedAsset({ quantity: 70 })
    );

    await adjustQuantity({
      assetId,
      quantity: 10,
      category: "ADJUSTMENT",
      direction: "subtract",
      userId,
      organizationId,
    });

    expect(vi.mocked(recordEvent).mock.calls[0][0]).toMatchObject({
      fromValue: 70,
      toValue: 60,
    });
  });

  it("emits nothing when the adjustment is rejected", async () => {
    // 90 of 100 units are in custody, so removing 40 must fail the
    // pool-drain guard before any write or event.
    tx.custody.aggregate.mockResolvedValue({ _sum: { quantity: 90 } });

    await expect(
      adjustQuantity({
        assetId,
        quantity: 40,
        category: "LOSS",
        direction: "subtract",
        userId,
        organizationId,
      })
    ).rejects.toThrow(/Cannot remove 40 units/);

    expect(tx.asset.update).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("emits nothing for a cross-org asset id", async () => {
    vi.mocked(lockAssetForQuantityUpdate).mockResolvedValue(
      lockedAsset({ organizationId: "other-org" })
    );

    await expect(
      adjustQuantity({
        assetId,
        quantity: 5,
        category: "RESTOCK",
        direction: "add",
        userId,
        organizationId,
      })
    ).rejects.toThrow(/does not belong to this organization/);

    expect(recordEvent).not.toHaveBeenCalled();
  });
});
