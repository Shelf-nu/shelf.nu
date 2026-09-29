/**
 * Database side of the stock ledger.
 *
 * Every write that changes a quantity-tracked asset's total or its manual
 * placements goes through two calls in its transaction:
 *
 * 1. {@link readStockStates} right after it takes the asset lock and before
 *    it writes anything, and
 * 2. {@link recordStockChanges} after its last write, with the events it
 *    performed.
 *
 * The rows written are the difference between those two states, so a replay
 * of the ledger matches the live stock whatever the write did in between
 * (a reconcile that drained the unplaced units first, a trimmed placement, a
 * location created on the fly). The rules are pure and live in
 * `stock-ledger.ts`.
 *
 * Hand-outs and returns (CHECKOUT, RETURN) change no stock and are written
 * by `createConsumptionLog` with a `stockChange` of 0.
 *
 * @see {@link file://./stock-ledger.ts}
 */

import type { ConsumptionCategory } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import type { StockEvent, StockState } from "./stock-ledger";
import {
  OPENING_BALANCE_CATEGORY,
  diffStockStates,
  planStockLedgerRows,
  stockByPlace,
} from "./stock-ledger";

/**
 * Transaction client the ledger reads and writes through. The extended
 * client's `$transaction` callback param is not assignable to the generated
 * `Prisma.TransactionClient`, so the tx-denied members are omitted instead,
 * the same approach as the custody source helpers.
 */
export type StockLedgerTxClient = Omit<ExtendedPrismaClient, ITXClientDenyList>;

/**
 * Reads the stock of each quantity-tracked asset in `assetIds`: its total and
 * its manual placements. INDIVIDUAL and unknown ids are absent from the map.
 *
 * Call it inside the transaction, after the asset lock and before any write,
 * and pass the result to {@link recordStockChanges}.
 *
 * @param tx - Transaction client holding the lock on these assets
 * @param assetIds - Assets the caller is about to change
 * @param organizationId - The caller's organization
 */
export async function readStockStates(
  tx: StockLedgerTxClient,
  { assetIds, organizationId }: { assetIds: string[]; organizationId: string }
): Promise<Map<string, StockState>> {
  const states = new Map<string, StockState>();
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return states;

  /**
   * One round trip for the total and every manual placement: this runs twice
   * inside each stock-changing transaction, which has a time budget.
   */
  const rows = await tx.$queryRaw<
    Array<{
      assetId: string;
      total: number | null;
      stockLedgerStartedAt: Date | null;
      locationId: string | null;
      placed: number | null;
    }>
  >`
    SELECT a.id AS "assetId", a.quantity AS total, a."stockLedgerStartedAt",
      al."locationId", al.quantity AS placed
    FROM "Asset" a
    LEFT JOIN "AssetLocation" al
      ON al."assetId" = a.id AND al."assetKitId" IS NULL
    WHERE a.id IN (${Prisma.join(ids)})
      AND a."organizationId" = ${organizationId}
      AND a.type = 'QUANTITY_TRACKED'
  `;

  for (const row of rows) {
    let state = states.get(row.assetId);
    if (!state) {
      state = {
        total: row.total ?? 0,
        placed: new Map(),
        ledgerStartedAt: row.stockLedgerStartedAt,
      };
      states.set(row.assetId, state);
    }
    if (row.locationId) {
      state.placed.set(
        row.locationId,
        (state.placed.get(row.locationId) ?? 0) + (row.placed ?? 0)
      );
    }
  }
  return states;
}

/** {@link readStockStates} for one asset; `null` when it is not quantity-tracked. */
export async function readStockState(
  tx: StockLedgerTxClient,
  { assetId, organizationId }: { assetId: string; organizationId: string }
): Promise<StockState | null> {
  const states = await readStockStates(tx, {
    assetIds: [assetId],
    organizationId,
  });
  return states.get(assetId) ?? null;
}

/** One asset's change, for {@link recordStockChanges}. */
export type StockChangeInput = {
  assetId: string;
  /**
   * {@link readStockStates} before the write, or `emptyStockState()` for an
   * asset this transaction created. `undefined` (an INDIVIDUAL asset, or one
   * the read did not return) records nothing.
   */
  before: StockState | undefined | null;
  /** What changed the total. Omit for a change that only moved units. */
  events?: StockEvent[];
};

/**
 * Writes the ledger rows for a change to one or more pools, inside the
 * caller's transaction.
 *
 * Reads each pool again, diffs it against `before` and writes one row per
 * place the change touched, labelled by the events (see
 * `planStockLedgerRows`). A pool whose ledger has not started yet first gets
 * OPENING_BALANCE rows for `before`, and `stockLedgerStartedAt` is set, so its
 * rows sum to its live stock from this change on.
 *
 * @param tx - The transaction that made the change, still holding the locks
 * @param organizationId - The caller's organization
 * @param userId - Who made the change
 * @param changes - One entry per asset
 */
export async function recordStockChanges(
  tx: StockLedgerTxClient,
  {
    organizationId,
    userId,
    changes,
  }: {
    organizationId: string;
    userId: string;
    changes: StockChangeInput[];
  }
): Promise<void> {
  const tracked = changes.filter(
    (entry): entry is StockChangeInput & { before: StockState } =>
      entry.before != null
  );
  if (tracked.length === 0) return;

  const after = await readStockStates(tx, {
    assetIds: tracked.map((entry) => entry.assetId),
    organizationId,
  });

  const rows: Prisma.ConsumptionLogCreateManyInput[] = [];
  const startedAssetIds: string[] = [];

  for (const { assetId, before, events = [] } of tracked) {
    const afterState = after.get(assetId);
    if (!afterState) continue;

    const placeChanges = diffStockStates(before, afterState);
    if (placeChanges.length === 0 && events.length === 0) continue;

    if (!before.ledgerStartedAt) {
      startedAssetIds.push(assetId);
      for (const { locationId, change } of stockByPlace(before)) {
        rows.push(
          ledgerRow({
            assetId,
            userId,
            category: OPENING_BALANCE_CATEGORY,
            locationId,
            stockChange: change,
          })
        );
      }
    }

    const { rows: planned, unexplained } = planStockLedgerRows({
      changes: placeChanges,
      events,
    });
    if (unexplained !== 0) {
      Logger.error(
        new ShelfError({
          cause: null,
          message:
            "A stock change did not match the events recorded for it; the difference was written as an adjustment.",
          additionalData: {
            assetId,
            unexplained,
            events: events.map((e) => ({
              category: e.category,
              change: e.change,
            })),
          },
          label: "Consumption Log",
          shouldBeCaptured: true,
        })
      );
    }
    for (const row of planned) {
      rows.push({ ...row, assetId, userId });
    }
  }

  if (startedAssetIds.length > 0) {
    /**
     * Raw SQL on purpose: a Prisma update would also bump `Asset.updatedAt`,
     * and starting the ledger is not an edit anyone made to the asset.
     */
    await tx.$executeRaw`
      UPDATE "Asset" SET "stockLedgerStartedAt" = NOW()
      WHERE id IN (${Prisma.join(startedAssetIds)})
        AND "organizationId" = ${organizationId}
    `;
  }
  if (rows.length > 0) {
    await tx.consumptionLog.createMany({ data: rows });
  }
}

/** A ledger row the ledger writes on its own (no booking, custodian or note). */
function ledgerRow({
  assetId,
  userId,
  category,
  locationId,
  stockChange,
}: {
  assetId: string;
  userId: string;
  category: ConsumptionCategory;
  locationId: string | null;
  stockChange: number;
}): Prisma.ConsumptionLogCreateManyInput {
  return {
    assetId,
    userId,
    category,
    quantity: Math.abs(stockChange),
    stockChange,
    locationId,
  };
}
