/**
 * Stock Movement Report (R11)
 *
 * A period movement statement for `QUANTITY_TRACKED` assets: what stock was
 * held at the start of the period, what came in, what went out and why, and
 * what remains. This is the shape wholesale and consumables customers keep
 * asking for, and the shape `ConsumptionLog` has been recording since it
 * shipped without anything ever reading it back.
 *
 * ## The balancing identity
 *
 * Every row satisfies, by construction:
 *
 *   opening + restocked + adjustments − consumed − lost − damaged = closing
 *
 * That is not a hope, it is how the numbers are derived. See
 * {@link buildMovementRow} for why the adjustment figure closes the identity
 * exactly rather than approximately.
 *
 * ## Why two sources
 *
 * `ActivityEvent.ASSET_QUANTITY_CHANGED` carries `fromValue`/`toValue`, so it
 * is the only **signed** record of stock movement — it says which direction
 * the total went. `ConsumptionLog` carries the **reason** (`RESTOCK`,
 * `CONSUME`, `LOSS`, `DAMAGE`, `ADJUSTMENT`) but stores `quantity` as an
 * always-positive magnitude, with the sign implied by the category.
 *
 * The report needs both: the events give exact arithmetic, the logs give the
 * breakdown.
 *
 * ## What counts as a stock movement
 *
 * `CHECKOUT` and `RETURN` are deliberately excluded. They move units between
 * the available pool and a custodian without changing `Asset.quantity`, so
 * including them would double-count against the closing balance. Only the
 * categories that actually change the total appear here.
 *
 * @see {@link file://./registry.ts} — report registration
 * @see {@link file://../consumption-log/service.server.ts} — the ledger
 * @see {@link file://../../routes/api+/assets.adjust-quantity.ts} — enforces the
 *   category/direction pairing this report's arithmetic depends on
 */

import type { Prisma } from "@prisma/client";
import { AssetType, ConsumptionCategory } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

import type {
  ReportKpi,
  ReportPayload,
  ResolvedTimeframe,
  StockMovementRow,
} from "./types";

const label: ErrorLabel = "Report";

/** Arguments for {@link stockMovementReport}. */
interface StockMovementArgs {
  organizationId: string;
  timeframe: ResolvedTimeframe;
  /** Optional category filter (asset categories, not consumption categories). */
  categoryIds?: string[];
  /** Optional location filter — matches assets placed at any of these. */
  locationIds?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * The signed quantity deltas for one asset, split by when they happened
 * relative to the reporting period.
 */
interface AssetDeltas {
  /** Sum of signed deltas INSIDE the period. */
  inPeriod: number;
  /**
   * Sum of signed deltas AFTER the period ended. Needed because
   * `Asset.quantity` is the CURRENT total, not the total as at the period
   * end — for any timeframe that is not "up to now" we have to walk back.
   */
  afterPeriod: number;
}

/** Per-asset consumption-log magnitudes for the period, by category. */
interface AssetCategoryTotals {
  restocked: number;
  consumed: number;
  lost: number;
  damaged: number;
}

const EMPTY_CATEGORY_TOTALS: AssetCategoryTotals = {
  restocked: 0,
  consumed: 0,
  lost: 0,
  damaged: 0,
};

/**
 * Reads a `ActivityEvent.fromValue`/`toValue` payload as a number.
 *
 * These are `Json` columns. `ASSET_QUANTITY_CHANGED` always writes plain
 * numbers into them, but the column type cannot promise that, so anything
 * non-numeric is treated as absent rather than coerced into a misleading `0`
 * that would silently corrupt a delta.
 */
function readQuantityValue(value: Prisma.JsonValue | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  // Defensive: a numeric string would still be a legitimate quantity.
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Collects signed quantity deltas per asset, split into in-period and
 * after-period buckets.
 *
 * Uses `findMany` + reduce rather than a raw aggregate because the delta is
 * `toValue - fromValue` across two `Json` columns, which Prisma's typed
 * aggregate API cannot express. Doing it in SQL would mean hand-casting jsonb
 * and losing schema-awareness (see `.claude/rules/raw-sql-respects-prisma-map`),
 * and the row set here is already narrowed to quantity-change events for
 * quantity-tracked assets in one workspace.
 */
async function fetchAssetDeltas({
  organizationId,
  assetIds,
  timeframe,
}: {
  organizationId: string;
  assetIds: string[];
  timeframe: ResolvedTimeframe;
}): Promise<Map<string, AssetDeltas>> {
  const deltas = new Map<string, AssetDeltas>();

  if (assetIds.length === 0) {
    return deltas;
  }

  const events = await db.activityEvent.findMany({
    where: {
      organizationId,
      action: "ASSET_QUANTITY_CHANGED",
      assetId: { in: assetIds },
      // Everything from the start of the period onwards: in-period events give
      // the movement, after-period events let us walk `Asset.quantity` back to
      // what it was at the period end.
      occurredAt: { gte: timeframe.from },
    },
    select: {
      assetId: true,
      occurredAt: true,
      fromValue: true,
      toValue: true,
    },
  });

  for (const event of events) {
    if (!event.assetId) continue;

    const from = readQuantityValue(event.fromValue);
    const to = readQuantityValue(event.toValue);

    // An event missing either side cannot contribute a delta. Skipping it
    // rather than guessing keeps the residual honest: the movement it
    // represents surfaces in the adjustment column instead of being invented
    // as a specific category.
    if (from === null || to === null) continue;

    const entry = deltas.get(event.assetId) ?? { inPeriod: 0, afterPeriod: 0 };
    const delta = to - from;

    if (event.occurredAt > timeframe.to) {
      entry.afterPeriod += delta;
    } else {
      entry.inPeriod += delta;
    }

    deltas.set(event.assetId, entry);
  }

  return deltas;
}

/**
 * Sums `ConsumptionLog` magnitudes per asset per category for the period.
 *
 * `CHECKOUT` and `RETURN` are excluded: they move units between the pool and
 * custody without changing `Asset.quantity`, so they are custody movements
 * rather than stock movements. `ADJUSTMENT` is excluded too — it is derived,
 * not summed (see {@link buildMovementRow}).
 */
async function fetchCategoryTotals({
  assetIds,
  timeframe,
}: {
  assetIds: string[];
  timeframe: ResolvedTimeframe;
}): Promise<Map<string, AssetCategoryTotals>> {
  const totals = new Map<string, AssetCategoryTotals>();

  if (assetIds.length === 0) {
    return totals;
  }

  const grouped = await db.consumptionLog.groupBy({
    by: ["assetId", "category"],
    where: {
      assetId: { in: assetIds },
      createdAt: { gte: timeframe.from, lte: timeframe.to },
      category: {
        in: [
          ConsumptionCategory.RESTOCK,
          ConsumptionCategory.CONSUME,
          ConsumptionCategory.LOSS,
          ConsumptionCategory.DAMAGE,
        ],
      },
    },
    _sum: { quantity: true },
  });

  for (const row of grouped) {
    const entry = totals.get(row.assetId) ?? { ...EMPTY_CATEGORY_TOTALS };
    const magnitude = row._sum.quantity ?? 0;

    switch (row.category) {
      case ConsumptionCategory.RESTOCK:
        entry.restocked += magnitude;
        break;
      case ConsumptionCategory.CONSUME:
        entry.consumed += magnitude;
        break;
      case ConsumptionCategory.LOSS:
        entry.lost += magnitude;
        break;
      case ConsumptionCategory.DAMAGE:
        entry.damaged += magnitude;
        break;
      default:
        // Unreachable given the `where` above; keeps the switch exhaustive
        // if a category is ever added to the filter without updating here.
        break;
    }

    totals.set(row.assetId, entry);
  }

  return totals;
}

/** The asset shape {@link buildMovementRow} needs. */
type AssetForMovement = {
  id: string;
  title: string;
  quantity: number | null;
  valuation: number | null;
  unitOfMeasure: string | null;
  category: { name: string } | null;
};

/**
 * Builds one statement row, closing the balancing identity exactly.
 *
 * The adjustment figure is **derived, not summed**, and that is the crux of
 * this report. `ConsumptionLog.quantity` is always positive and the sign lives
 * in the category. For every category except `ADJUSTMENT` the sign is
 * *enforced* at the route (`assets.adjust-quantity.ts` refuses `RESTOCK` that
 * subtracts and `LOSS` that adds; `CONSUME` and `DAMAGE` only ever subtract).
 * `ADJUSTMENT` is deliberately allowed both directions, so its sign cannot be
 * recovered from the ledger alone.
 *
 * But it does not need to be. With the net change known from the signed event
 * trail and every other category's direction fixed, there is exactly one
 * unknown and one equation:
 *
 *   adjustments = netChange − restocked + consumed + lost + damaged
 *
 * This has two properties worth keeping. The statement can never fail to
 * balance, which is the first thing anyone checks on a report like this. And
 * if stock ever moves without writing a `ConsumptionLog` row — the exact bug
 * class this codebase keeps finding — the discrepancy lands visibly in the
 * adjustment column instead of silently corrupting a category.
 *
 * The cost, stated plainly for anyone reading a row: a period containing a
 * +5 correction and a −3 correction reports +2. Gross detail is available on
 * the asset's own activity log, which lists each entry with its actor and note.
 */
function buildMovementRow({
  asset,
  deltas,
  categoryTotals,
}: {
  asset: AssetForMovement;
  deltas: AssetDeltas;
  categoryTotals: AssetCategoryTotals;
}): StockMovementRow {
  const currentQuantity = asset.quantity ?? 0;

  // `Asset.quantity` is current. Walk back anything that happened after the
  // period to get the balance as at the period end.
  const closing = currentQuantity - deltas.afterPeriod;
  const opening = closing - deltas.inPeriod;

  const { restocked, consumed, lost, damaged } = categoryTotals;

  const adjustments =
    deltas.inPeriod - restocked + consumed + lost + damaged;

  const unitValue = asset.valuation ?? 0;

  return {
    id: asset.id,
    assetId: asset.id,
    assetName: asset.title,
    category: asset.category?.name ?? null,
    unitOfMeasure: asset.unitOfMeasure,
    opening,
    restocked,
    consumed,
    lost,
    damaged,
    adjustments,
    closing,
    unitValue: asset.valuation,
    closingValue: unitValue * closing,
  };
}

/** Builds the KPI strip for the report. */
function buildStockMovementKpis(rows: StockMovementRow[]): ReportKpi[] {
  const totalConsumed = rows.reduce((sum, row) => sum + row.consumed, 0);
  const totalRestocked = rows.reduce((sum, row) => sum + row.restocked, 0);
  const totalShrinkage = rows.reduce(
    (sum, row) => sum + row.lost + row.damaged,
    0
  );
  const closingValue = rows.reduce((sum, row) => sum + row.closingValue, 0);

  return [
    {
      id: "total_consumed",
      label: "Consumed",
      value: totalConsumed.toLocaleString(),
      rawValue: totalConsumed,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_restocked",
      label: "Restocked",
      value: totalRestocked.toLocaleString(),
      rawValue: totalRestocked,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_shrinkage",
      label: "Lost or damaged",
      value: totalShrinkage.toLocaleString(),
      rawValue: totalShrinkage,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "closing_value",
      label: "Closing value",
      value:
        closingValue > 0
          ? `$${closingValue.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}`
          : "—",
      rawValue: closingValue,
      format: "currency",
      delta: null,
      deltaType: "neutral",
    },
  ];
}

/**
 * Generate the Stock Movement report.
 *
 * @param args - Organization, timeframe, optional filters and pagination
 * @returns The report payload: KPIs, one row per quantity-tracked asset
 * @throws {ShelfError} If any underlying query fails
 */
export async function stockMovementReport(
  args: StockMovementArgs
): Promise<ReportPayload<StockMovementRow>> {
  const {
    organizationId,
    timeframe,
    categoryIds,
    locationIds,
    page = 1,
    pageSize = 50,
  } = args;

  const startTime = performance.now();

  try {
    // Only quantity-tracked assets have a stock level to move. INDIVIDUAL
    // assets are one physical thing; they are checked out and back, never
    // consumed down.
    const where: Prisma.AssetWhereInput = {
      organizationId,
      type: AssetType.QUANTITY_TRACKED,
    };

    if (categoryIds && categoryIds.length > 0) {
      where.categoryId = { in: categoryIds };
    }

    if (locationIds && locationIds.length > 0) {
      where.assetLocations = { some: { locationId: { in: locationIds } } };
    }

    const [assets, totalCount] = await Promise.all([
      db.asset.findMany({
        where,
        select: {
          id: true,
          title: true,
          quantity: true,
          valuation: true,
          unitOfMeasure: true,
          category: { select: { name: true } },
        },
        orderBy: { title: "asc" },
        skip: page > 1 ? (page - 1) * pageSize : 0,
        take: pageSize,
      }),
      db.asset.count({ where }),
    ]);

    const assetIds = assets.map((asset) => asset.id);

    const [deltas, categoryTotals] = await Promise.all([
      fetchAssetDeltas({ organizationId, assetIds, timeframe }),
      fetchCategoryTotals({ assetIds, timeframe }),
    ]);

    const rows = assets.map((asset) =>
      buildMovementRow({
        asset,
        deltas: deltas.get(asset.id) ?? { inPeriod: 0, afterPeriod: 0 },
        categoryTotals: categoryTotals.get(asset.id) ?? {
          ...EMPTY_CATEGORY_TOTALS,
        },
      })
    );

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "stock-movement",
        title: "Stock Movement",
        description:
          "Opening stock, what moved and why, and closing stock for every quantity-tracked asset.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis: buildStockMovementKpis(rows),
      rows,
      computedMs,
      totalRows: totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while generating the stock movement report. Please try again or contact support.",
      additionalData: { organizationId, timeframe: timeframe.preset },
      label,
    });
  }
}
