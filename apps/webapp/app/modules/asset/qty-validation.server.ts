/**
 * Shared validator for the quantity-tracked CSV columns + AssetModel.
 *
 * Both the create-from-content import (`createAssetsFromContentImport` →
 * `parseQtyTrackedCsvRow`) and the update-from-content import
 * (`applyBulkUpdatesFromImport` → `parseQtyTrackedUpdateRow`) need to
 * validate the same set of columns with the same per-field error
 * messages — customers may have screenshots of the create-path errors
 * and the update path must read identically. Extracting the validator
 * keeps the two parsers from drifting field-by-field.
 *
 * Create path (`parseQtyTrackedCsvRow`):
 *   - `type` defaults to INDIVIDUAL when omitted
 *   - `quantity` (required >0 for QUANTITY_TRACKED, must be ≤1 for INDIVIDUAL)
 *   - `minQuantity`, `unitOfMeasure`, `consumptionType` all per spec
 *
 * Update path (`parseQtyTrackedUpdateRow`):
 *   - `type` cell is silently ignored — type is immutable on update
 *   - `quantity` / `minQuantity` / `unitOfMeasure` / `consumptionType`
 *     cells on INDIVIDUAL rows are silently ignored (export → re-import
 *     noise)
 *   - `assetModel` cell on QUANTITY_TRACKED row is warn + drop the cell
 *     (the row's other updatable cells still apply)
 *
 * @see {@link file://./service.server.ts} — `parseQtyTrackedCsvRow` consumer
 * @see {@link file://./../../utils/import-update.server.ts} — `applyBulkUpdatesFromImport` consumer
 */
import { AssetType, ConsumptionType } from "@prisma/client";

import { sanitizeUnitOfMeasureLabel } from "~/utils/asset-quantity";
import { ShelfError } from "~/utils/error";

/**
 * Subset of `AdditionalData` accepted by this validator. Mirrors the
 * shape `ShelfError.additionalData` already accepts (string keys, JSON-
 * serialisable values) so callers don't need to import `AdditionalData`
 * directly.
 */
type QtyValidationExtraData = {
  [key: string]: string | number | boolean | object | null | undefined;
};

const LABEL = "Assets";

/**
 * Accepted string values for the `type` CSV column.
 *
 * Stored as a Set for O(1) membership checks during parsing.
 */
export const CSV_ASSET_TYPES = new Set<string>([
  AssetType.INDIVIDUAL,
  AssetType.QUANTITY_TRACKED,
]);

/**
 * Accepted string values for the `consumptionType` CSV column.
 */
export const CSV_CONSUMPTION_TYPES = new Set<string>([
  ConsumptionType.ONE_WAY,
  ConsumptionType.TWO_WAY,
]);

/**
 * Raw CSV cells we care about for qty validation. Cells are accepted as
 * unknown / undefined so callers can pass create-path rows
 * (`CreateAssetFromContentImportPayload` — keys present as strings) or
 * update-path rows (column-indexed values that may be missing entirely).
 */
export type QtyTrackedCsvCells = {
  type?: string;
  quantity?: string;
  minQuantity?: string;
  unitOfMeasure?: string;
  consumptionType?: string;
};

/**
 * Per-row context used to build helpful error / warning messages.
 *
 * `rowLabel` is the human-readable identifier (e.g. `asset "Drill #3"`).
 * `additionalData` is forwarded to `ShelfError.additionalData` so the
 * Sentry payload retains the row's key (CSV `key` column on create;
 * matched asset id on update).
 */
export type QtyTrackedRowContext = {
  rowLabel: string;
  additionalData?: QtyValidationExtraData;
};

/**
 * Successfully-validated, typed values for the qty-tracked columns.
 *
 * `type` is `undefined` only on the create path when the cell is blank
 * (the caller defaults to INDIVIDUAL via the schema). The update path
 * never reads this field — it ignores the `type` cell entirely.
 */
export type ValidatedQtyTrackedFields = {
  type: AssetType | undefined;
  quantity: number | undefined;
  minQuantity: number | undefined;
  unitOfMeasure: string | undefined;
  consumptionType: ConsumptionType | undefined;
};

/**
 * Behavioural switch passed by the caller.
 *
 * - `create` enforces the QUANTITY_TRACKED-required-quantity invariant
 *   AND the INDIVIDUAL-must-have-quantity-≤1 invariant.
 * - `update` operates against the existing asset's type (the type cell
 *   is silently ignored). INDIVIDUAL rows have qty-tracked-only cells
 *   silently dropped; QUANTITY_TRACKED rows still validate quantity
 *   shape when provided but do NOT require it (an update CSV may simply
 *   not touch the quantity column).
 */
export type QtyValidationMode =
  | { kind: "create" }
  | { kind: "update"; existingType: AssetType };

/**
 * Validates the quantity-tracked + consumption columns of a single CSV
 * row. Throws a row-tagged `ShelfError` (HTTP 400) on any malformed
 * value so the import surface can show "row 14: quantity must be a
 * positive integer" rather than a generic 500 from deeper in the chain.
 *
 * The exact error messages here are part of the public contract —
 * customers may have screenshots, so do NOT reword them when refactoring.
 *
 * @param cells - The raw CSV cells (string keys, undefined when absent)
 * @param mode - `create` vs `update` (controls required-vs-optional rules)
 * @param ctx - Row label + Sentry additionalData for thrown errors
 * @returns Typed, validated, possibly-undefined values
 * @throws {ShelfError} 400 on any column-format failure
 */
export function validateQtyTrackedFields(
  cells: QtyTrackedCsvCells,
  mode: QtyValidationMode,
  ctx: QtyTrackedRowContext
): ValidatedQtyTrackedFields {
  const { rowLabel, additionalData } = ctx;

  // ── type ────────────────────────────────────────────────────────────
  // Create path: parse + validate; default INDIVIDUAL when blank.
  // Update path: silently ignore the cell — type is immutable per the
  // Wave-1 decision. The caller still passes `existingType` so the
  // qty / consumption rules can branch correctly.
  const rawType =
    typeof cells.type === "string" ? cells.type.trim().toUpperCase() : "";
  let parsedType: AssetType | undefined;

  if (mode.kind === "create") {
    if (rawType === "") {
      parsedType = undefined; // create path defaults via schema
    } else if (CSV_ASSET_TYPES.has(rawType)) {
      parsedType = rawType as AssetType;
    } else {
      throw new ShelfError({
        cause: null,
        title: "Invalid asset type",
        message: `Invalid type "${cells.type}" for ${rowLabel}. Must be "INDIVIDUAL" or "QUANTITY_TRACKED".`,
        label: LABEL,
        status: 400,
        shouldBeCaptured: false,
        additionalData: { ...additionalData, type: cells.type },
      });
    }
  }
  const effectiveType =
    mode.kind === "create"
      ? parsedType ?? AssetType.INDIVIDUAL
      : mode.existingType;

  // ── quantity ────────────────────────────────────────────────────────
  const rawQty =
    typeof cells.quantity === "string" ? cells.quantity.trim() : "";
  let parsedQty: number | undefined;
  if (rawQty !== "") {
    const n = Number(rawQty);
    if (!Number.isInteger(n) || n < 0) {
      throw new ShelfError({
        cause: null,
        title: "Invalid quantity",
        message: `Invalid quantity "${cells.quantity}" for ${rowLabel}. Must be a non-negative whole number.`,
        label: LABEL,
        status: 400,
        shouldBeCaptured: false,
        additionalData: { ...additionalData, quantity: cells.quantity },
      });
    }
    parsedQty = n;
  }

  if (effectiveType === AssetType.QUANTITY_TRACKED) {
    // Create path: quantity is required.
    // Update path: quantity is optional on update — only validate the
    // ">0 if present" rule (the parsed-int check above already covers
    // the format). A QUANTITY_TRACKED row in an update CSV may legally
    // omit / blank the quantity column entirely.
    if (mode.kind === "create") {
      if (parsedQty === undefined || parsedQty <= 0) {
        throw new ShelfError({
          cause: null,
          title: "Quantity required",
          message: `Quantity is required (and must be > 0) for QUANTITY_TRACKED ${rowLabel}.`,
          label: LABEL,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { ...additionalData },
        });
      }
    } else if (parsedQty !== undefined && parsedQty <= 0) {
      throw new ShelfError({
        cause: null,
        title: "Quantity required",
        message: `Quantity is required (and must be > 0) for QUANTITY_TRACKED ${rowLabel}.`,
        label: LABEL,
        status: 400,
        shouldBeCaptured: false,
        additionalData: { ...additionalData },
      });
    }
  } else if (effectiveType === AssetType.INDIVIDUAL && mode.kind === "create") {
    if (parsedQty !== undefined && parsedQty > 1) {
      throw new ShelfError({
        cause: null,
        title: "Invalid quantity for INDIVIDUAL",
        message: `INDIVIDUAL assets must have quantity 1 (or omit the column). Got "${cells.quantity}" for ${rowLabel}. To track stock, set type=QUANTITY_TRACKED.`,
        label: LABEL,
        status: 400,
        shouldBeCaptured: false,
        additionalData: { ...additionalData, quantity: cells.quantity },
      });
    }
  }

  // ── minQuantity ─────────────────────────────────────────────────────
  const rawMin =
    typeof cells.minQuantity === "string" ? cells.minQuantity.trim() : "";
  let parsedMin: number | undefined;
  if (rawMin !== "") {
    const n = Number(rawMin);
    if (!Number.isInteger(n) || n < 0) {
      throw new ShelfError({
        cause: null,
        title: "Invalid min quantity",
        message: `Invalid minQuantity "${cells.minQuantity}" for ${rowLabel}. Must be a non-negative whole number.`,
        label: LABEL,
        status: 400,
        shouldBeCaptured: false,
        additionalData: {
          ...additionalData,
          minQuantity: cells.minQuantity,
        },
      });
    }
    parsedMin = n;
  }

  // ── unitOfMeasure ───────────────────────────────────────────────────
  // Sanitised to strip Markdoc tokens — see Phase 4e Hex follow-up.
  const rawUnit =
    typeof cells.unitOfMeasure === "string"
      ? sanitizeUnitOfMeasureLabel(cells.unitOfMeasure)
      : "";
  const parsedUnit = rawUnit === "" ? undefined : rawUnit;

  // ── consumptionType ─────────────────────────────────────────────────
  const rawCt =
    typeof cells.consumptionType === "string"
      ? cells.consumptionType.trim().toUpperCase()
      : "";
  let parsedCt: ConsumptionType | undefined;
  if (rawCt !== "") {
    if (!CSV_CONSUMPTION_TYPES.has(rawCt)) {
      throw new ShelfError({
        cause: null,
        title: "Invalid consumption type",
        message: `Invalid consumptionType "${cells.consumptionType}" for ${rowLabel}. Must be "ONE_WAY" or "TWO_WAY".`,
        label: LABEL,
        status: 400,
        shouldBeCaptured: false,
        additionalData: {
          ...additionalData,
          consumptionType: cells.consumptionType,
        },
      });
    }
    parsedCt = rawCt as ConsumptionType;
  }

  // Consumption type is required on the create path for QUANTITY_TRACKED
  // rows. On the update path it's optional (an update may simply not
  // touch the consumptionType column).
  if (
    mode.kind === "create" &&
    effectiveType === AssetType.QUANTITY_TRACKED &&
    !parsedCt
  ) {
    throw new ShelfError({
      cause: null,
      title: "Consumption type required",
      message: `Consumption type is required for QUANTITY_TRACKED ${rowLabel}. Must be "ONE_WAY" or "TWO_WAY".`,
      label: LABEL,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { ...additionalData },
    });
  }

  return {
    type: parsedType,
    quantity: parsedQty,
    minQuantity: parsedMin,
    unitOfMeasure: parsedUnit,
    consumptionType: parsedCt,
  };
}

// ---------------------------------------------------------------------------
// Update-path parser
// ---------------------------------------------------------------------------

/**
 * Patches the update path can apply to an asset. All keys are optional;
 * absent keys mean "no change". `assetModelLookupKey` is the raw
 * (trimmed) `assetModel` cell value — the caller is responsible for
 * resolving it to an `assetModelId` via `batchResolveAssetModelNames`.
 */
export type ParsedQtyTrackedUpdatePatch = {
  quantity?: number;
  minQuantity?: number;
  unitOfMeasure?: string;
  consumptionType?: ConsumptionType;
  /**
   * Trimmed `assetModel` cell value. Resolution to an `assetModelId`
   * happens in the caller — the parser only validates that the cell is
   * compatible with the row's type (drops + warns when the asset is
   * QUANTITY_TRACKED).
   */
  assetModelLookupKey?: string;
};

/**
 * Per-row warning surfaced back to the import caller. The caller
 * accumulates these and folds them into the response payload so the
 * route handler can show "row 14: assetModel cell ignored (this asset
 * is QUANTITY_TRACKED)" without rejecting the whole row.
 */
export type QtyTrackedUpdateWarning = {
  rowIndex: number;
  message: string;
};

/**
 * Per-row hard rejection. The caller treats these like any other
 * per-row failure (counts toward `failed`, doesn't roll back the
 * import). Errors only fire for unambiguously-malformed cell shapes
 * (non-integer quantity, invalid enum value); the warn-and-skip path
 * is preferred for "user provided an unsupported but understandable
 * thing" cases.
 */
export type QtyTrackedUpdateError = {
  rowIndex: number;
  message: string;
};

/**
 * Result of `parseQtyTrackedUpdateRow` — a patch the caller spreads
 * into the per-row update payload, plus accumulated warnings and any
 * hard rejection (one row produces at most one error).
 */
export type ParsedQtyTrackedUpdate = {
  patch: ParsedQtyTrackedUpdatePatch;
  warnings: QtyTrackedUpdateWarning[];
  errors: QtyTrackedUpdateError[];
};

/**
 * Minimal asset shape the update parser needs. Only the type is
 * load-bearing — it decides which cells apply (qty-tracked fields on
 * INDIVIDUAL rows are silently dropped; assetModel on QUANTITY_TRACKED
 * rows is warn-and-skip).
 */
export type ExistingAssetForQtyUpdate = {
  type: AssetType;
};

/**
 * Parses the qty-tracked + assetModel cells from an UPDATE-path CSV
 * row. Returns the patch the caller can spread into an asset update,
 * plus accumulated warnings (for cells we dropped intentionally) and
 * errors (for unambiguously-malformed cells).
 *
 * Behaviour (per user decisions in
 * `superpowers/IMPORT-QTY-TRACKED-SUPPORT.md` "Decisions"):
 *
 * 1. The `type` cell is silently ignored — whatever the cell contains
 *    (matching, divergent, blank), the existing asset's type wins.
 *    No error, no warning.
 * 2. On INDIVIDUAL rows: `quantity`, `minQuantity`, `unitOfMeasure`,
 *    and `consumptionType` cells are silently ignored. The cells are
 *    dropped from the patch with no warning — export → re-import noise.
 * 3. On QUANTITY_TRACKED rows: the `assetModel` cell is dropped and a
 *    warning is recorded so the user knows it didn't take effect.
 *
 * @param cells - The CSV cells extracted by the caller (column-indexed)
 * @param existing - The existing asset (only `type` is consulted)
 * @param rowIndex - 1-based row index used to tag warnings / errors so
 *   the route handler can surface "row 14: …"
 * @returns The patch + collected warnings + (at most one) error
 */
export function parseQtyTrackedUpdateRow(
  cells: QtyTrackedCsvCells & { assetModel?: string },
  existing: ExistingAssetForQtyUpdate,
  rowIndex: number
): ParsedQtyTrackedUpdate {
  const warnings: QtyTrackedUpdateWarning[] = [];
  const errors: QtyTrackedUpdateError[] = [];

  // Build the cell subset we'll validate, dropping qty-tracked-only
  // cells when the existing asset is INDIVIDUAL (silent — per decision
  // #2 above). The `type` cell is always ignored on update.
  const isQuantityTracked = existing.type === AssetType.QUANTITY_TRACKED;

  const cellsToValidate: QtyTrackedCsvCells = isQuantityTracked
    ? {
        quantity: cells.quantity,
        minQuantity: cells.minQuantity,
        unitOfMeasure: cells.unitOfMeasure,
        consumptionType: cells.consumptionType,
      }
    : {}; // INDIVIDUAL: drop all qty-tracked-only cells silently

  let validated: ValidatedQtyTrackedFields;
  try {
    validated = validateQtyTrackedFields(
      cellsToValidate,
      { kind: "update", existingType: existing.type },
      {
        rowLabel: `row ${rowIndex}`,
        additionalData: { rowIndex },
      }
    );
  } catch (cause) {
    // A malformed qty cell (non-integer, negative, bad enum, etc.) —
    // collect as a per-row error and return an empty patch so the
    // caller can record the failure without aborting the import.
    const msg =
      cause instanceof ShelfError
        ? cause.message
        : "Unknown qty-tracked validation error";
    errors.push({ rowIndex, message: msg });
    return { patch: {}, warnings, errors };
  }

  // ── assetModel cell handling ────────────────────────────────────────
  // INDIVIDUAL: forward the trimmed name to the caller for batch
  //   resolution.
  // QUANTITY_TRACKED: drop (per decision #3) — the user-facing warning
  //   is surfaced by the diff layer's warning-marked FieldChange (see
  //   `compareCoreField` case "assetModel" in `import-update-diff.ts`),
  //   which the apply layer forwards into `result.warnings`. Emitting
  //   a warning here too would duplicate the entry in the UI's yellow
  //   pill — the diff layer is the single source of truth so the same
  //   row never shows the same warning twice.
  const rawModel =
    typeof cells.assetModel === "string" ? cells.assetModel.trim() : "";

  let assetModelLookupKey: string | undefined;
  if (rawModel !== "" && !isQuantityTracked) {
    assetModelLookupKey = rawModel;
  }

  return {
    patch: {
      quantity: validated.quantity,
      minQuantity: validated.minQuantity,
      unitOfMeasure: validated.unitOfMeasure,
      consumptionType: validated.consumptionType,
      assetModelLookupKey,
    },
    warnings,
    errors,
  };
}
