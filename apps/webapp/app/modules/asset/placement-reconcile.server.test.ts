/**
 * Placement reconciliation on stock decrease — unit tests.
 *
 * The invariant under test comes from the quantitative-assets PRD:
 * `SUM(AssetLocation.quantity WHERE assetKitId IS NULL) <= Asset.quantity`.
 * Consumption lowers the right-hand side, so these tests pin what happens to
 * the left-hand side in each shape.
 *
 * @see {@link file://./placement-reconcile.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  assertStockNotBelowManualPlacements,
  reconcileManualPlacementsForStockDecrease,
  reportAmbiguousPlacementReconcile,
} from "./placement-reconcile.server";

/**
 * Builds a tx double over the two delegate methods the module uses.
 *
 * why: the module is a pure decision over a row set plus at most one write.
 * A hand-rolled double keeps each test's placement shape visible at the call
 * site, which is the thing under test.
 */
function txWith(
  placements: Array<{ id: string; locationId: string; quantity: number }>
) {
  // why: the unit under test is a decision over a row set, not the Prisma
  // round-trip. Faking the two delegate methods keeps each scenario's
  // placement shape at the call site and lets the assertions be about WHICH
  // write happened, which a real client would hide behind the database.
  const update = vi.fn().mockResolvedValue({});
  const destroy = vi.fn().mockResolvedValue({});
  return {
    tx: {
      assetLocation: {
        findMany: vi.fn().mockResolvedValue(placements),
        update,
        delete: destroy,
      },
    },
    update,
    // Named `destroy` locally because `delete` is a reserved word in strict
    // mode; the delegate method it stands in for is `assetLocation.delete`.
    destroy,
  };
}

describe("reconcileManualPlacementsForStockDecrease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing while the unplaced residual still absorbs the decrease", async () => {
    // 100 total dropping to 90, only 50 placed — the residual takes it.
    const { tx, update } = txWith([
      { id: "p1", locationId: "loc-gear", quantity: 50 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 90,
      tx,
    });

    expect(result).toEqual({ outcome: "within_total" });
    // The honest default: shrinking the residual asserts nothing about any
    // location, so no placement may be touched.
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing when the sum exactly equals the new total", async () => {
    // Boundary: 87 placed, total lands on 87. Still valid, still no write.
    const { tx, update } = txWith([
      { id: "p1", locationId: "loc-gear", quantity: 87 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 87,
      tx,
    });

    expect(result).toEqual({ outcome: "within_total" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reduces the single placement once the residual is exhausted", async () => {
    // The reproduced bug: 87 placed, all 87 owned, consume 5 -> total 82.
    // One placement, so the source is a fact rather than a guess.
    const { tx, update } = txWith([
      { id: "p1", locationId: "loc-gear", quantity: 87 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 82,
      tx,
    });

    expect(result).toEqual({
      outcome: "reduced",
      locationId: "loc-gear",
      reducedBy: 5,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { quantity: 82 },
    });
  });

  it("reduces only by the overshoot when the residual covers part of it", async () => {
    // 88 placed of 90 owned (residual 2), consume 10 -> total 80.
    // The residual absorbs 2, so only the remaining 8 comes off the placement.
    const { tx, update } = txWith([
      { id: "p1", locationId: "loc-gear", quantity: 88 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 80,
      tx,
    });

    expect(result).toEqual({
      outcome: "reduced",
      locationId: "loc-gear",
      reducedBy: 8,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { quantity: 80 },
    });
  });

  it("deletes the placement rather than leaving a zero-unit row", async () => {
    // Consuming the last placed unit must remove the row. Placement lists and
    // the editor treat row existence as "the asset is here", and
    // `replaceAssetPlacements` rejects any quantity below 1, so a 0-unit row
    // would render as a location holding nothing that the user cannot clear.
    // Mirrors `moveAssetLocationUnits`, which deletes a drained source row.
    const { tx, update, destroy } = txWith([
      { id: "p1", locationId: "loc-gear", quantity: 5 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 0,
      tx,
    });

    expect(result).toEqual({
      outcome: "reduced",
      locationId: "loc-gear",
      reducedBy: 5,
    });
    expect(destroy).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("never writes a negative placement", async () => {
    // Defensive: a caller passing a nonsense total must not produce a
    // negative row, which would breach the pivot's own semantics. The row is
    // removed at zero rather than clamped in place.
    const { tx, update, destroy } = txWith([
      { id: "p1", locationId: "loc-gear", quantity: 5 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: -3,
      tx,
    });

    expect(result).toEqual({
      outcome: "reduced",
      locationId: "loc-gear",
      reducedBy: 5,
    });
    expect(destroy).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports ambiguity instead of guessing across several placements", async () => {
    // 100 placed across two rooms, total drops to 90. Nothing records which
    // room the units left, so any rule here would invent provenance.
    const { tx, update } = txWith([
      { id: "p1", locationId: "loc-baghdad", quantity: 60 },
      { id: "p2", locationId: "loc-erbil", quantity: 40 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 90,
      tx,
    });

    expect(result).toEqual({
      outcome: "ambiguous",
      deficit: 10,
      locationIds: ["loc-baghdad", "loc-erbil"],
    });
    // The point of this branch: no fabricated write.
    expect(update).not.toHaveBeenCalled();
  });

  it("survives a negative total with nothing placed", async () => {
    // Both defensive inputs at once. With no rows, `placedSum` is 0, which is
    // NOT <= a negative total — so without the explicit empty-set term this
    // fell through to the single-placement branch and destructured `undefined`
    // out of an empty array, throwing a TypeError inside the caller's
    // transaction instead of reporting "nothing to reconcile".
    const { tx, update, destroy } = txWith([]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: -3,
      tx,
    });

    expect(result).toEqual({ outcome: "within_total" });
    expect(update).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("still absorbs into the residual when several placements fit", async () => {
    // Multi-placement is only ambiguous once the residual is gone.
    const { tx, update } = txWith([
      { id: "p1", locationId: "loc-baghdad", quantity: 30 },
      { id: "p2", locationId: "loc-erbil", quantity: 20 },
    ]);

    const result = await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 60,
      tx,
    });

    expect(result).toEqual({ outcome: "within_total" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reads only manual placements, never kit-driven rows", async () => {
    // Kit-driven rows are bounded by enforce_asset_kit_sum_within_total and
    // were deliberately excluded from the location-axis sum. Reaching across
    // that boundary would re-conflate the two axes.
    const { tx } = txWith([]);

    await reconcileManualPlacementsForStockDecrease({
      assetId: "asset-1",
      newTotal: 10,
      tx,
    });

    expect(tx.assetLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-1", assetKitId: null },
      })
    );
  });
});

/**
 * Builds a tx double over the single read the guard performs.
 *
 * why: the guard is a pure decision over the manual placement rows — a
 * hand-rolled double keeps the placed total visible at each call site.
 */
function guardTxWith(
  placements: Array<{ id: string; locationId: string; quantity: number }>
) {
  const findMany = vi.fn().mockResolvedValue(placements);
  return { tx: { assetLocation: { findMany } }, findMany };
}

describe("assertStockNotBelowManualPlacements", () => {
  const baseArgs = {
    assetId: "asset-1",
    organizationId: "org-1",
    assetTitle: "Nitrile Gloves",
    unitOfMeasure: "pcs",
  };

  it("allows a reduction the unplaced residual covers", async () => {
    const { tx } = guardTxWith([
      { id: "p1", locationId: "loc-gear", quantity: 50 },
    ]);

    await expect(
      assertStockNotBelowManualPlacements({ ...baseArgs, newTotal: 90, tx })
    ).resolves.toBeUndefined();
  });

  it("allows a reduction that lands exactly on the placed sum", async () => {
    // Boundary: fully placed is still a valid state, so it must not reject.
    const { tx } = guardTxWith([
      { id: "p1", locationId: "loc-gear", quantity: 87 },
    ]);

    await expect(
      assertStockNotBelowManualPlacements({ ...baseArgs, newTotal: 87, tx })
    ).resolves.toBeUndefined();
  });

  it("refuses a reduction that would strand placed units, naming both numbers", async () => {
    // Nothing has physically moved yet, so the operator is told to unplace
    // first rather than having a location silently trimmed for them.
    const { tx } = guardTxWith([
      { id: "p1", locationId: "loc-gear", quantity: 87 },
    ]);

    await expect(
      assertStockNotBelowManualPlacements({ ...baseArgs, newTotal: 82, tx })
    ).rejects.toThrow(
      'Cannot reduce "Nitrile Gloves" to 82 pcs — 87 pcs are assigned to locations. Lower the placements first, then reduce the total.'
    );
  });

  it("sums across several placements before deciding", async () => {
    // The multi-location shape the reconcile refuses to guess at. Here it is
    // decidable, because refusing needs no provenance.
    const { tx } = guardTxWith([
      { id: "p1", locationId: "loc-baghdad", quantity: 60 },
      { id: "p2", locationId: "loc-erbil", quantity: 40 },
    ]);

    await expect(
      assertStockNotBelowManualPlacements({ ...baseArgs, newTotal: 90, tx })
    ).rejects.toThrow("100 pcs are assigned to locations");
  });

  it("treats an asset with no placements as unconstrained", async () => {
    const { tx } = guardTxWith([]);

    await expect(
      assertStockNotBelowManualPlacements({ ...baseArgs, newTotal: 0, tx })
    ).resolves.toBeUndefined();
  });

  it("counts only manual rows, leaving the kit axis to its own constraint", async () => {
    const { tx, findMany } = guardTxWith([]);

    await assertStockNotBelowManualPlacements({
      ...baseArgs,
      newTotal: 10,
      tx,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-1", assetKitId: null },
      })
    );
  });
});

/**
 * The `ambiguous` branch does exactly one thing — report — so the report IS
 * the behaviour. Without these, a refactor could drop the logging and every
 * other assertion in this file would still pass while the drift went silent.
 */
describe("reportAmbiguousPlacementReconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs the deficit and the contending locations", () => {
    // why: Logger is the observable output of this function; spying is the
    // only way to assert it without a real transport.
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});

    reportAmbiguousPlacementReconcile({
      result: {
        outcome: "ambiguous",
        deficit: 10,
        locationIds: ["loc-baghdad", "loc-erbil"],
      },
      context: "Check-in",
      additionalData: { assetId: "asset-1", bookingId: "booking-1" },
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const reported = errorSpy.mock.calls[0][0] as ShelfError;
    expect(reported.message).toContain("Check-in");
    expect(reported.additionalData).toMatchObject({
      assetId: "asset-1",
      bookingId: "booking-1",
      deficit: 10,
      locationIds: ["loc-baghdad", "loc-erbil"],
    });
  });

  it("stays silent for outcomes that need no human", () => {
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});

    reportAmbiguousPlacementReconcile({
      result: { outcome: "within_total" },
      context: "Check-in",
      additionalData: { assetId: "asset-1" },
    });
    reportAmbiguousPlacementReconcile({
      result: { outcome: "reduced", locationId: "loc-1", reducedBy: 5 },
      context: "Check-in",
      additionalData: { assetId: "asset-1" },
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
