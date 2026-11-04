/**
 * Unit counts on audit rows.
 *
 * An audit row (`AuditAsset`) of a QUANTITY_TRACKED asset carries two numbers:
 * `expectedQuantity`, snapshotted when the row is created, and
 * `foundQuantity`, what the auditor counted. The snapshot is the units placed
 * at the audited locations for a location audit, and the whole pool
 * (`Asset.quantity`) otherwise. Both are null on
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

/**
 * Largest count the server stores for one row: the Postgres INTEGER ceiling.
 * `Asset.quantity` has no lower cap, so a smaller bound would refuse a full
 * count of a large pool.
 */
export const MAX_AUDIT_FOUND_QUANTITY = 2_147_483_647;

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

/**
 * The locations an audit was scoped to, read from its `scopeMeta`. An audit
 * started from one or more locations stores them there (with their child
 * locations when those were included); any other audit has none.
 *
 * @returns the location ids, or null when the audit is not location-scoped
 */
export function scopedLocationIds(scopeMeta: unknown): string[] | null {
  if (!scopeMeta || typeof scopeMeta !== "object") return null;
  const ids = (scopeMeta as { locationIds?: unknown }).locationIds;
  if (!Array.isArray(ids)) return null;
  const strings = ids.filter((id): id is string => typeof id === "string");
  return strings.length > 0 ? strings : null;
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

/** Unit totals across an audit's quantity rows. */
export type AuditUnitTotals = {
  /** Expected rows of quantity-tracked assets. */
  quantityRows: number;
  /** Sum of `expectedQuantity` over expected rows. */
  expectedUnits: number;
  /** Sum of counted units over expected rows; a MISSING row adds 0. */
  foundUnits: number;
  /** Expected quantity rows still without a count (not scanned yet, or scanned by a build that did not ask). */
  uncountedRows: number;
  /** Rows of quantity-tracked assets the audit did not expect. */
  unexpectedRows: number;
  /** Units counted on those rows. */
  unexpectedUnits: number;
};

/**
 * Totals the unit counts of an audit's rows. Expected rows make the
 * expected-versus-found comparison; units counted on rows the audit never
 * expected are totalled apart, so they are reported without being compared
 * with anything. A MISSING row (the audit completed without it) counts as
 * zero found, not as uncounted.
 *
 * @param rows - every row of the audit, with its `expected` flag and status
 * @returns the totals, or null when the audit holds no quantity rows (surfaces
 *   then show nothing extra)
 */
export function totalAuditUnits(
  rows: ReadonlyArray<
    AuditRowQuantity & { expected: boolean; status?: string | null }
  >
): AuditUnitTotals | null {
  const totals: AuditUnitTotals = {
    quantityRows: 0,
    expectedUnits: 0,
    foundUnits: 0,
    uncountedRows: 0,
    unexpectedRows: 0,
    unexpectedUnits: 0,
  };

  for (const row of rows) {
    if (!isQuantityAuditRow(row)) continue;
    if (!row.expected) {
      totals.unexpectedRows += 1;
      totals.unexpectedUnits += row.foundQuantity ?? 0;
      continue;
    }
    totals.quantityRows += 1;
    totals.expectedUnits += row.expectedQuantity ?? 0;
    if (row.foundQuantity !== null && row.foundQuantity !== undefined) {
      totals.foundUnits += row.foundQuantity;
    } else if (row.status !== "MISSING") {
      totals.uncountedRows += 1;
    }
  }

  return totals.quantityRows + totals.unexpectedRows > 0 ? totals : null;
}

/** "1 quantity-tracked asset" / "2 quantity-tracked assets". */
function quantityAssets(count: number): string {
  return `${count} quantity-tracked ${count === 1 ? "asset" : "assets"}`;
}

/**
 * The units line under an audit's statistics, e.g. "Units counted: 8 of 14
 * across 1 quantity-tracked asset, 1 not counted yet; 5 more on 1
 * quantity-tracked asset not on the list." One wording for the overview and
 * the receipt.
 */
export function describeAuditUnits(totals: AuditUnitTotals): string {
  const unexpected = `${totals.unexpectedUnits} ${
    totals.quantityRows > 0 ? "more " : ""
  }on ${quantityAssets(totals.unexpectedRows)} not on the list`;
  if (totals.quantityRows === 0) {
    return `Units counted: ${unexpected}.`;
  }
  const uncounted =
    totals.uncountedRows > 0 ? `, ${totals.uncountedRows} not counted yet` : "";
  const extra = totals.unexpectedRows > 0 ? `; ${unexpected}` : "";
  return `Units counted: ${totals.foundUnits} of ${
    totals.expectedUnits
  } across ${quantityAssets(totals.quantityRows)}${uncounted}${extra}.`;
}
