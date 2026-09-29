/**
 * Stock Movement report — statement arithmetic.
 *
 * The report's central claim is that every row balances:
 *
 *   opening + restocked + adjustments − consumed − lost − damaged = closing
 *
 * These tests drive the real `stockMovementReport` with only the database
 * mocked, so they exercise the actual derivation rather than a restatement of
 * it. The balancing assertion is repeated per scenario deliberately: it is the
 * property a reader of the report relies on, and any future change to the
 * derivation should have to break it explicitly.
 *
 * @see {@link file://./stock-movement.server.ts}
 */

import { ConsumptionCategory } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the report is three database reads and a pure derivation. Mocking the
// client lets each test state an exact ledger/event history and assert the
// arithmetic that falls out of it.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn(), count: vi.fn() },
    activityEvent: { findMany: vi.fn() },
    consumptionLog: { groupBy: vi.fn() },
  },
}));

import { db } from "~/database/db.server";

import { stockMovementReport } from "./stock-movement.server";
import type { ResolvedTimeframe, StockMovementRow } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_month",
  label: "Last month",
  from: new Date("2026-07-01T00:00:00Z"),
  to: new Date("2026-07-31T23:59:59Z"),
};

const IN_PERIOD = new Date("2026-07-15T12:00:00Z");
const AFTER_PERIOD = new Date("2026-08-03T12:00:00Z");

/** A quantity-tracked asset with 100 units currently in stock at $1.50. */
function asset(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "asset-1",
    title: "Plastic Pen (Black)",
    quantity: 100,
    valuation: 1.5,
    unitOfMeasure: "pcs",
    category: { name: "Giveaways" },
    ...overrides,
  };
}

/** One `ASSET_QUANTITY_CHANGED` event. */
function quantityEvent(from: number, to: number, occurredAt = IN_PERIOD) {
  return { assetId: "asset-1", occurredAt, fromValue: from, toValue: to };
}

/** One `ConsumptionLog` groupBy row. */
function logGroup(category: ConsumptionCategory, quantity: number) {
  return { assetId: "asset-1", category, _sum: { quantity } };
}

/**
 * Asserts the statement identity for a row. This is the report's contract;
 * if it ever fails the report is not a statement, it is a list of numbers.
 */
function expectRowToBalance(row: StockMovementRow) {
  const derived =
    row.opening +
    row.restocked +
    row.adjustments -
    row.consumed -
    row.lost -
    row.damaged;

  expect(derived).toBe(row.closing);
}

async function runReport() {
  return stockMovementReport({
    organizationId: "org-1",
    timeframe: TIMEFRAME,
  });
}

describe("stockMovementReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.asset.findMany).mockResolvedValue([asset()] as never);
    vi.mocked(db.asset.count).mockResolvedValue(1 as never);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as never);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([] as never);
  });

  it("derives opening from closing and the in-period movement", async () => {
    // 30 consumed during the period: stock went 130 -> 100.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      quantityEvent(130, 100),
    ] as never);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
      logGroup(ConsumptionCategory.CONSUME, 30),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].opening).toBe(130);
    expect(rows[0].closing).toBe(100);
    expect(rows[0].consumed).toBe(30);
    expect(rows[0].adjustments).toBe(0);
    expectRowToBalance(rows[0]);
  });

  it("walks Asset.quantity back past movements AFTER the period", async () => {
    /**
     * `Asset.quantity` is today's number, not the period's. Here 100 is
     * current, but 10 of those were restocked in August, so July closed at 90.
     */
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      quantityEvent(120, 90, IN_PERIOD),
      quantityEvent(90, 100, AFTER_PERIOD),
    ] as never);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
      logGroup(ConsumptionCategory.CONSUME, 30),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].closing).toBe(90);
    expect(rows[0].opening).toBe(120);
    expectRowToBalance(rows[0]);
  });

  it("derives a NEGATIVE adjustment the ledger cannot sign on its own", async () => {
    /**
     * The crux. A stocktake wrote off 5 units as an ADJUSTMENT. The ledger
     * stores that as a positive 5 with no direction, so the sign is only
     * recoverable from the signed event trail. Net change is -35, of which
     * -30 is explained by CONSUME, leaving -5.
     */
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      quantityEvent(135, 100),
    ] as never);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
      logGroup(ConsumptionCategory.CONSUME, 30),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].adjustments).toBe(-5);
    expectRowToBalance(rows[0]);
  });

  it("derives a POSITIVE adjustment from the same ledger shape", async () => {
    // Same categories, opposite direction: a stocktake found 5 extra.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      quantityEvent(125, 100),
    ] as never);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
      logGroup(ConsumptionCategory.CONSUME, 30),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].adjustments).toBe(5);
    expectRowToBalance(rows[0]);
  });

  it("balances with every movement category at once", async () => {
    // 200 -> 100. Restock +50, consume 100, loss 30, damage 15, so the
    // remaining -5 must be adjustments.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      quantityEvent(200, 100),
    ] as never);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
      logGroup(ConsumptionCategory.RESTOCK, 50),
      logGroup(ConsumptionCategory.CONSUME, 100),
      logGroup(ConsumptionCategory.LOSS, 30),
      logGroup(ConsumptionCategory.DAMAGE, 15),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].restocked).toBe(50);
    expect(rows[0].consumed).toBe(100);
    expect(rows[0].lost).toBe(30);
    expect(rows[0].damaged).toBe(15);
    expect(rows[0].adjustments).toBe(-5);
    expectRowToBalance(rows[0]);
  });

  it("never asks the ledger for CHECKOUT or RETURN", async () => {
    /**
     * Those move units between the pool and a custodian without changing
     * `Asset.quantity`. Counting them would break the identity, so they must
     * not even be queried.
     */
    await runReport();

    const where = vi.mocked(db.consumptionLog.groupBy).mock.calls[0][0].where;
    const categories = (where?.category as { in: ConsumptionCategory[] }).in;

    expect(categories).not.toContain(ConsumptionCategory.CHECKOUT);
    expect(categories).not.toContain(ConsumptionCategory.RETURN);
  });

  it("surfaces unexplained movement in adjustments instead of losing it", async () => {
    /**
     * Stock dropped by 20 with NO ledger entry at all — the bug class this
     * codebase keeps finding. The statement still balances and the anomaly is
     * visible rather than silently absent.
     */
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      quantityEvent(120, 100),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].adjustments).toBe(-20);
    expectRowToBalance(rows[0]);
  });

  it("ignores an event whose payload is not numeric", async () => {
    // A malformed payload must not be coerced to 0 — that would invent a
    // delta equal to the whole stock level.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { assetId: "asset-1", occurredAt: IN_PERIOD, fromValue: null, toValue: 100 },
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].opening).toBe(100);
    expect(rows[0].closing).toBe(100);
    expectRowToBalance(rows[0]);
  });

  it("values closing stock at the asset's unit value", async () => {
    const { rows } = await runReport();

    expect(rows[0].unitValue).toBe(1.5);
    expect(rows[0].closingValue).toBe(150);
  });

  it("treats a valueless asset as zero rather than failing", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset({ valuation: null }),
    ] as never);

    const { rows } = await runReport();

    expect(rows[0].unitValue).toBeNull();
    expect(rows[0].closingValue).toBe(0);
  });
});
