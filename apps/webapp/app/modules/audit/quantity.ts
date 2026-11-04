/**
 * Unit counts on audit rows.
 *
 * An audit row (`AuditAsset`) of a QUANTITY_TRACKED asset carries two numbers:
 * `expectedQuantity`, snapshotted from `Asset.quantity` when the row is
 * created, and `foundQuantity`, what the auditor counted. Both are null on
 * INDIVIDUAL assets, which count as one.
 *
 * The row status keeps answering "was the pool located?" (FOUND / MISSING /
 * UNEXPECTED). A shortfall is not a status: a FOUND row with
 * `foundQuantity < expectedQuantity` is a pool that was located with units
 * short, and surfaces read the gap from these two numbers.
 *
 * Pure module (no server imports) so the web components, the PDF and the
 * server share one wording.
 */

import { AssetType } from "@prisma/client";

/** Largest count an auditor can enter for one row. */
export const MAX_AUDIT_FOUND_QUANTITY = 1_000_000;

/**
 * The expected-units snapshot for a new audit row.
 *
 * @param asset - the asset being added to the audit
 * @returns `Asset.quantity` (0 when unset) for a quantity-tracked asset, null
 *   for an individual one
 */
export function expectedQuantityFor(asset: {
  type: AssetType | null | undefined;
  quantity: number | null | undefined;
}): number | null {
  if (asset.type !== AssetType.QUANTITY_TRACKED) return null;
  return asset.quantity ?? 0;
}

/** The count fields a surface needs to describe one audit row. */
export type AuditRowQuantity = {
  expectedQuantity: number | null | undefined;
  foundQuantity: number | null | undefined;
};

/**
 * Whether the row belongs to a quantity-tracked asset.
 *
 * The snapshot is the marker: every row of a quantity-tracked asset gets an
 * `expectedQuantity` when it is created, individual rows never do.
 */
export function isQuantityAuditRow(row: AuditRowQuantity): boolean {
  return row.expectedQuantity !== null && row.expectedQuantity !== undefined;
}

/**
 * One-line count for a quantity row, e.g. "8 of 14 pcs".
 *
 * @param row - the row's count fields
 * @param unit - `Asset.unitOfMeasure`; omitted when null or the default
 *   "units" literal, which reads as noise
 * @returns the label, "Not counted" for a quantity row without a count yet,
 *   or null for an individual row (callers render nothing extra)
 */
export function formatAuditQuantity(
  row: AuditRowQuantity,
  unit?: string | null
): string | null {
  if (!isQuantityAuditRow(row)) return null;
  const suffix = unit && unit !== "units" ? ` ${unit}` : "";
  if (row.foundQuantity === null || row.foundQuantity === undefined) {
    return `Not counted (${row.expectedQuantity}${suffix} expected)`;
  }
  return `${row.foundQuantity} of ${row.expectedQuantity}${suffix}`;
}

/** Unit totals across an audit's quantity rows. */
export type AuditUnitTotals = {
  /** Rows of quantity-tracked assets, expected or not. */
  quantityRows: number;
  /** Sum of `expectedQuantity` over expected rows. */
  expectedUnits: number;
  /** Sum of `foundQuantity` over expected rows that were counted. */
  foundUnits: number;
  /** Expected quantity rows with no count yet. */
  uncountedRows: number;
};

/**
 * Totals the unit counts of an audit's rows. Unexpected rows add to
 * `quantityRows` only: units the audit never expected are not part of the
 * expected-versus-found comparison.
 *
 * @param rows - every row of the audit, with its `expected` flag
 * @returns the totals, or null when the audit holds no quantity rows (surfaces
 *   then show nothing extra)
 */
export function totalAuditUnits(
  rows: ReadonlyArray<AuditRowQuantity & { expected: boolean }>
): AuditUnitTotals | null {
  const totals: AuditUnitTotals = {
    quantityRows: 0,
    expectedUnits: 0,
    foundUnits: 0,
    uncountedRows: 0,
  };

  for (const row of rows) {
    if (!isQuantityAuditRow(row)) continue;
    totals.quantityRows += 1;
    if (!row.expected) continue;
    totals.expectedUnits += row.expectedQuantity ?? 0;
    if (row.foundQuantity === null || row.foundQuantity === undefined) {
      totals.uncountedRows += 1;
    } else {
      totals.foundUnits += row.foundQuantity;
    }
  }

  return totals.quantityRows > 0 ? totals : null;
}
