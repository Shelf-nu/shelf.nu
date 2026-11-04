/**
 * Unit counts on audit rows.
 *
 * An audit row (`AuditAsset`) of a QUANTITY_TRACKED asset carries two numbers:
 * `expectedQuantity`, snapshotted when the row is created, and
 * `foundQuantity`, what the auditor counted. The snapshot is the units in the
 * audit's scope (see `AuditUnitScope`): placed at the audited locations, held
 * in the audited kits, or held by the audited person, never more than the
 * pool. It is the whole pool (`Asset.quantity`) when none of the pool is in
 * scope or the audit has no scope. Both are null on INDIVIDUAL assets, which
 * count as one.
 *
 * The row status keeps answering "was the pool located?" (FOUND / MISSING /
 * UNEXPECTED). A shortfall is not a status: a FOUND row with
 * `foundQuantity < expectedQuantity` is a pool that was located with units
 * short, and surfaces read the gap from these two numbers.
 *
 * Pure module (no server imports) so the web components, the PDF and the
 * server share one wording.
 */

import type { AssetType } from "@prisma/client";
import { MAX_AUDIT_COUNT } from "@shelf/quantity-control";
import { isQuantityTracked } from "~/modules/asset/utils";

/**
 * Largest count the server stores for one row: the Postgres INTEGER ceiling,
 * shared with the phone (`MAX_AUDIT_COUNT` in `@shelf/quantity-control`).
 * `Asset.quantity` has no lower cap, so a smaller bound would refuse a full
 * count of a large pool.
 */
export const MAX_AUDIT_FOUND_QUANTITY = MAX_AUDIT_COUNT;

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
  if (!isQuantityTracked(asset)) return null;
  return asset.quantity ?? 0;
}

/**
 * Where an audit counts the units of a quantity-tracked asset: the units
 * placed at some locations, held in some kits, or held by one person. An
 * audit of a selection of assets or of the index has no such scope and counts
 * the whole pool.
 */
export type AuditUnitScope =
  | { kind: "locations"; locationIds: string[] }
  | { kind: "kits"; kitIds: string[] }
  | { kind: "custodian"; custodianUserId: string };

/** The non-empty string ids of a stored list, or null. */
function storedIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? ids : null;
}

/**
 * The unit scope an audit stored in its `scopeMeta` when it started:
 * `locationIds` for an audit of locations (child locations included when
 * chosen), `kitIds` for an audit of kits, `custodianUserId` for an audit of a
 * person's custody.
 *
 * @returns the scope, or null when the audit counts whole pools
 */
export function auditUnitScope(scopeMeta: unknown): AuditUnitScope | null {
  if (!scopeMeta || typeof scopeMeta !== "object") return null;
  const meta = scopeMeta as {
    locationIds?: unknown;
    kitIds?: unknown;
    custodianUserId?: unknown;
  };
  const locationIds = storedIds(meta.locationIds);
  if (locationIds) return { kind: "locations", locationIds };
  const kitIds = storedIds(meta.kitIds);
  if (kitIds) return { kind: "kits", kitIds };
  if (typeof meta.custodianUserId === "string" && meta.custodianUserId) {
    return { kind: "custodian", custodianUserId: meta.custodianUserId };
  }
  return null;
}

/**
 * The expected units of a pool in a scoped audit: the units in scope, never
 * more than the pool, or the whole pool when none are in scope (a pool added
 * by hand, or scanned without being on the list, is expected in full rather
 * than at 0).
 *
 * @param scopedUnits - units of the pool inside the audit's scope
 * @param pool - `Asset.quantity`
 */
export function scopedExpectedUnits(scopedUnits: number, pool: number): number {
  return scopedUnits > 0 ? Math.min(scopedUnits, pool) : pool;
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
  /** Those rows still without a count (scanned by a build that did not ask). */
  unexpectedUncountedRows: number;
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
    unexpectedUncountedRows: 0,
  };

  for (const row of rows) {
    if (!isQuantityAuditRow(row)) continue;
    if (!row.expected) {
      totals.unexpectedRows += 1;
      if (row.foundQuantity === null || row.foundQuantity === undefined) {
        totals.unexpectedUncountedRows += 1;
      } else {
        totals.unexpectedUnits += row.foundQuantity;
      }
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
 * across 1 quantity-tracked asset, 1 not counted; 5 more on 1
 * quantity-tracked asset not on the list." One wording for the overview and
 * the receipt.
 */
export function describeAuditUnits(totals: AuditUnitTotals): string {
  const unexpectedUncounted =
    totals.unexpectedUncountedRows > 0
      ? `, ${totals.unexpectedUncountedRows} not counted`
      : "";
  const unexpected = `${totals.unexpectedUnits} ${
    totals.quantityRows > 0 ? "more " : ""
  }on ${quantityAssets(
    totals.unexpectedRows
  )} not on the list${unexpectedUncounted}`;
  if (totals.quantityRows === 0) {
    return `Units counted: ${unexpected}.`;
  }
  const uncounted =
    totals.uncountedRows > 0 ? `, ${totals.uncountedRows} not counted` : "";
  const extra = totals.unexpectedRows > 0 ? `; ${unexpected}` : "";
  return `Units counted: ${totals.foundUnits} of ${
    totals.expectedUnits
  } across ${quantityAssets(totals.quantityRows)}${uncounted}${extra}.`;
}

/**
 * The heading of an audit row's details panel, led by its count label:
 * "Counted: 8 of 14 pcs • Notes and images" for a counted expected row, the
 * label alone otherwise ("Not counted", "14 pcs expected", and "8 pcs counted"
 * for an unexpected row, whose label already says counted), and "Notes and
 * images" for an individual asset (no label).
 *
 * @param countLabel - `auditCountLabel` for the row, or null
 * @param row - the row's status and count
 */
export function auditRowHeading(
  countLabel: string | null,
  row: { status: string; foundQuantity: number | null }
): string {
  if (!countLabel) return "Notes and images";
  const prefix =
    row.foundQuantity !== null && row.status !== "UNEXPECTED"
      ? "Counted: "
      : "";
  return `${prefix}${countLabel} • Notes and images`;
}
