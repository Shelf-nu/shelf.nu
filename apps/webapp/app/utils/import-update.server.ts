/**
 * @file Server-side orchestration for bulk asset update via CSV import.
 * Coordinates header analysis, diff computation, entity resolution,
 * and batch update application. Delegates to focused modules for each concern.
 *
 * @see {@link file://./import-update-types.ts} Types and constants
 * @see {@link file://./import-update-diff.ts} Pure diff logic
 * @see {@link file://./import-update-entities.server.ts} Entity resolution
 * @see {@link file://./../../routes/_layout+/assets.import-update.tsx} Route handler
 */
import type { User } from "@prisma/client";
import { AssetType } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  parseQtyTrackedUpdateRow,
  type ParsedQtyTrackedUpdatePatch,
} from "~/modules/asset/qty-validation.server";
import {
  updateAsset,
  updateAssetBookingAvailability,
} from "~/modules/asset/service.server";
import type {
  ICustomFieldValueJson,
  UpdateAssetPayload,
} from "~/modules/asset/types";
import { buildCustomFieldValue } from "~/utils/custom-fields";
import { ShelfError, isLikeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  analyzeUpdateHeaders,
  computeAssetDiffs,
  describeBulkUpdateRowFailure,
  normalizeExportedCurrencyValue,
  parseYesNo,
} from "./import-update-diff";
import {
  batchResolveAssetModelNames,
  batchResolveCategoryNames,
  batchResolveLocationNames,
  detectNewEntities,
  fetchAssetsForUpdate,
  resolveTagNamesToIds,
} from "./import-update-entities.server";
import type {
  AssetForUpdate,
  BulkUpdateResult,
  FieldChange,
  UpdatePreview,
} from "./import-update-types";
import { MAX_BULK_UPDATE_ROWS } from "./import-update-types";

// Re-export types and key functions so existing consumers don't break
export type {
  AssetChangePreview,
  AssetForUpdate,
  BulkUpdateResult,
  FieldChange,
  HeaderAnalysis,
  UpdatePreview,
} from "./import-update-types";
export { analyzeUpdateHeaders, computeAssetDiffs } from "./import-update-diff";
export { fetchAssetsForUpdate } from "./import-update-entities.server";

// ---------------------------------------------------------------------------
// Build Full Preview
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full preview: parse headers, fetch assets, compute diffs.
 * Returns a complete UpdatePreview with change details, warnings, and
 * information about new entities that will be created.
 *
 * @param csvData - Full CSV data array (first row is headers)
 * @param organizationId - Organization scope for the query
 * @returns Complete preview of all changes that would be applied
 * @throws {ShelfError} If no identifier column found or row limit exceeded
 */
export async function buildUpdatePreview({
  csvData,
  organizationId,
}: {
  csvData: string[][];
  organizationId: string;
}): Promise<UpdatePreview> {
  const headers = csvData[0].map((h) => h.trim());
  const dataRows = csvData.slice(1);

  // Guard against oversized imports
  if (dataRows.length > MAX_BULK_UPDATE_ROWS) {
    throw new ShelfError({
      cause: null,
      message: `CSV contains ${dataRows.length} data rows, but the maximum is ${MAX_BULK_UPDATE_ROWS}. Please split your file into smaller batches.`,
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  // Get org custom fields for header analysis
  const orgCustomFields = await db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
    select: { id: true, name: true, type: true },
  });

  const headerAnalysis = analyzeUpdateHeaders(headers, orgCustomFields);

  // Validate: must have at least one identifier column
  if (headerAnalysis.idColumnIndex === -1) {
    throw new ShelfError({
      cause: null,
      message:
        "No identifier column found. Your CSV needs an Asset ID or ID column. The ID column is automatically included in all Asset Index exports.",
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  // Extract all identifier values from data rows
  const allIds = dataRows
    .map((row) => row[headerAnalysis.idColumnIndex]?.trim())
    .filter(Boolean) as string[];

  // Fetch existing assets using whichever identifier column was found
  const existingAssets = await fetchAssetsForUpdate(
    allIds,
    organizationId,
    headerAnalysis.idDbField
  );

  // If a fallback identifier column exists, also fetch by that
  // so rows with blank primary IDs can still match
  let fallbackAssets: Map<string, AssetForUpdate> | undefined;
  if (headerAnalysis.fallbackId) {
    const fallbackIds = dataRows
      .map((row) => row[headerAnalysis.fallbackId!.index]?.trim())
      .filter(Boolean) as string[];
    if (fallbackIds.length > 0) {
      fallbackAssets = await fetchAssetsForUpdate(
        fallbackIds,
        organizationId,
        headerAnalysis.fallbackId.dbField
      );
    }
  }

  // Compute diffs
  const diffs = computeAssetDiffs({
    csvData,
    headerAnalysis,
    existingAssets,
    fallbackAssets,
  });

  // Compute field change stats
  const totalFieldChanges = diffs.assetsToUpdate.reduce(
    (sum, a) => sum + a.changes.length,
    0
  );
  // Total possible fields = rows with found assets × updatable columns
  const assetsWithData =
    diffs.assetsToUpdate.length + diffs.skippedAssets.length;
  const totalPossibleFields =
    assetsWithData * headerAnalysis.updatableColumns.length;
  const totalUnchangedFields = totalPossibleFields - totalFieldChanges;

  // Detect new entities that would be created
  const newEntities = await detectNewEntities(
    diffs.assetsToUpdate,
    headerAnalysis,
    organizationId
  );

  return {
    ...diffs,
    ignoredColumns: headerAnalysis.ignoredColumns,
    unrecognizedColumns: headerAnalysis.unrecognizedColumns,
    updatableColumns: headerAnalysis.updatableColumns.map((c) => c.csvHeader),
    totalFieldChanges,
    totalUnchangedFields: Math.max(0, totalUnchangedFields),
    newEntities,
  };
}

// ---------------------------------------------------------------------------
// Apply Updates
// ---------------------------------------------------------------------------

/**
 * Applies bulk updates from an import CSV.
 * Re-parses the CSV from scratch (stateless) to get fresh database state,
 * resolves all entities in batch, then applies changes per asset with
 * partial failure handling.
 *
 * @param csvData - Full CSV data array (first row is headers)
 * @param organizationId - Organization scope
 * @param userId - User performing the import
 * @param request - Original HTTP request (passed through to updateAsset)
 * @returns Results summary with updated, skipped, and failed assets
 * @throws {ShelfError} If no identifier column found or row limit exceeded
 */
export async function applyBulkUpdatesFromImport({
  csvData,
  organizationId,
  userId,
  request,
}: {
  csvData: string[][];
  organizationId: string;
  userId: User["id"];
  request: Request;
}): Promise<BulkUpdateResult> {
  // Re-compute preview to get fresh state
  const headers = csvData[0].map((h) => h.trim());
  const dataRows = csvData.slice(1);

  // Guard against oversized imports
  if (dataRows.length > MAX_BULK_UPDATE_ROWS) {
    throw new ShelfError({
      cause: null,
      message: `CSV contains ${dataRows.length} data rows, but the maximum is ${MAX_BULK_UPDATE_ROWS}. Please split your file into smaller batches.`,
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  const orgCustomFields = await db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
    select: { id: true, name: true, type: true },
  });

  const headerAnalysis = analyzeUpdateHeaders(headers, orgCustomFields);

  if (headerAnalysis.idColumnIndex === -1) {
    throw new ShelfError({
      cause: null,
      message:
        "No identifier column found. Your CSV needs an Asset ID or ID column.",
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  const allIds = dataRows
    .map((row) => row[headerAnalysis.idColumnIndex]?.trim())
    .filter(Boolean) as string[];

  const existingAssets = await fetchAssetsForUpdate(
    allIds,
    organizationId,
    headerAnalysis.idDbField
  );

  // Fetch by fallback identifier if available
  let fallbackAssets: Map<string, AssetForUpdate> | undefined;
  if (headerAnalysis.fallbackId) {
    const fallbackIds = dataRows
      .map((row) => row[headerAnalysis.fallbackId!.index]?.trim())
      .filter(Boolean) as string[];
    if (fallbackIds.length > 0) {
      fallbackAssets = await fetchAssetsForUpdate(
        fallbackIds,
        organizationId,
        headerAnalysis.fallbackId.dbField
      );
    }
  }

  const diffs = computeAssetDiffs({
    csvData,
    headerAnalysis,
    existingAssets,
    fallbackAssets,
  });

  // Build a full custom field map (name → CustomField) for building values
  const allCfs = await db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
  });
  const cfByName = new Map(allCfs.map((cf) => [cf.name.toLowerCase(), cf]));

  // Pre-resolve all entity names in batch to avoid N+1 queries in the loop
  const categoryNameMap = new Map<string, string>();
  const locationNameMap = new Map<string, string>();
  const tagNameMap = new Map<string, string>();

  const allCategoryNames = new Set<string>();
  const allLocationNames = new Set<string>();
  const allTagNames = new Set<string>();

  for (const asset of diffs.assetsToUpdate) {
    for (const change of asset.changes) {
      if (change.warning) continue;
      const col = headerAnalysis.updatableColumns.find(
        (c) => c.csvHeader === change.field
      );
      if (!col) continue;
      if (col.internalKey === "category") allCategoryNames.add(change.newValue);
      if (col.internalKey === "location") allLocationNames.add(change.newValue);
      if (col.internalKey === "tags") {
        change.newValue
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => allTagNames.add(t));
      }
    }
  }

  // Resolve categories, locations, and tags in parallel using batch queries
  const [batchedCategories, batchedLocations] = await Promise.all([
    batchResolveCategoryNames([...allCategoryNames], userId, organizationId),
    batchResolveLocationNames([...allLocationNames], userId, organizationId),
  ]);
  for (const [name, id] of batchedCategories) categoryNameMap.set(name, id);
  for (const [name, id] of batchedLocations) locationNameMap.set(name, id);

  // Batch resolve tags
  if (allTagNames.size > 0) {
    // Ensure all tags exist (creates missing ones)
    await resolveTagNamesToIds([...allTagNames], userId, organizationId);
    // Fetch all org tags to build the name → id map
    const allOrgTags = await db.tag.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    for (const tag of allOrgTags) {
      tagNameMap.set(tag.name.toLowerCase(), tag.id);
    }
  }

  // Process updates
  const updated: BulkUpdateResult["updated"] = [];
  const skipped: BulkUpdateResult["skipped"] = diffs.skippedAssets;
  const failed: BulkUpdateResult["failed"] = diffs.failedRows.map((f) => ({
    id: f.id,
    title: "",
    rowNumber: f.rowNumber,
    error: f.reason,
  }));
  /**
   * Per-row warnings surfaced back to the caller. Populated by the
   * qty-tracked update parser (e.g. assetModel cell dropped on a
   * QUANTITY_TRACKED row). Warnings do not prevent the row from
   * applying — they're transparency only.
   */
  const warnings: BulkUpdateResult["warnings"] = [];

  // Build row-number index by both primary and fallback identifiers
  const seenIdsForRow = new Map<string, number>();
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx];
    const primaryId = row[headerAnalysis.idColumnIndex]?.trim();
    if (primaryId && !seenIdsForRow.has(primaryId)) {
      seenIdsForRow.set(primaryId, rowIdx);
    }
    if (headerAnalysis.fallbackId) {
      const fallbackVal = row[headerAnalysis.fallbackId.index]?.trim();
      if (fallbackVal && !seenIdsForRow.has(fallbackVal)) {
        seenIdsForRow.set(fallbackVal, rowIdx);
      }
    }
  }

  // ── Qty-tracked + AssetModel pre-pass ──────────────────────────────
  // For every row that maps to an existing asset, parse the
  // qty-tracked + assetModel cells via the shared validator. The
  // parser drops cells silently per the Wave-1 decisions (type cell
  // ignored; qty-tracked-only cells dropped on INDIVIDUAL rows;
  // assetModel warn + dropped on QUANTITY_TRACKED rows). The result
  // is indexed by `assetDbId` so the per-row apply loop can look it
  // up without re-parsing.
  //
  // Column indices: we look up the qty-tracked columns by their
  // expected internal keys via `headerAnalysis.columnIndexMap`. If a
  // column isn't present in the CSV, its index is undefined and the
  // parser sees an empty cell — which it correctly treats as "no
  // change requested".
  const qtyColIndex = new Map<string, number>();
  for (const [colIdx, col] of headerAnalysis.columnIndexMap) {
    if (
      col.internalKey === "quantity" ||
      col.internalKey === "minQuantity" ||
      col.internalKey === "unitOfMeasure" ||
      col.internalKey === "consumptionType" ||
      col.internalKey === "assetModel" ||
      col.internalKey === "type"
    ) {
      qtyColIndex.set(col.internalKey, colIdx);
    }
  }

  /**
   * Per-asset qty-tracked + assetModel patch payload. Keyed by the
   * canonical asset UUID (not the CSV identifier) so the apply loop
   * can resolve it regardless of which identifier column the row used.
   */
  const qtyPatchesByAssetDbId = new Map<string, ParsedQtyTrackedUpdatePatch>();
  /** Distinct assetModel names to batch-resolve. INDIVIDUAL rows only. */
  const assetModelNamesToResolve = new Set<string>();

  for (const assetPreview of diffs.assetsToUpdate) {
    const existingAsset =
      existingAssets.get(assetPreview.id) ??
      fallbackAssets?.get(assetPreview.id);
    if (!existingAsset) continue;

    // Locate the source row index so warnings / errors can reference
    // the user-visible row number (1-based, header at row 1 → data
    // rows start at row 2).
    const rowIdx = seenIdsForRow.get(assetPreview.id);
    const rowNumber = rowIdx !== undefined ? rowIdx + 2 : 0;

    const row = rowIdx !== undefined ? dataRows[rowIdx] : undefined;
    const readCell = (key: string): string | undefined => {
      const idx = qtyColIndex.get(key);
      if (idx === undefined || !row) return undefined;
      const cell = row[idx];
      return typeof cell === "string" ? cell : undefined;
    };

    // If the existing asset's type couldn't be loaded (test fixtures
    // / very old DB shapes), default to INDIVIDUAL so the parser
    // applies the most restrictive ruleset (qty-tracked-only cells
    // dropped). Real callers — `fetchAssetsForUpdate` — always
    // provide the field.
    const existingType = existingAsset.type ?? AssetType.INDIVIDUAL;
    const parsed = parseQtyTrackedUpdateRow(
      {
        type: readCell("type"),
        quantity: readCell("quantity"),
        minQuantity: readCell("minQuantity"),
        unitOfMeasure: readCell("unitOfMeasure"),
        consumptionType: readCell("consumptionType"),
        assetModel: readCell("assetModel"),
      },
      { type: existingType },
      rowNumber
    );

    // Collect warnings (per decision #3: assetModel on qty-tracked).
    for (const w of parsed.warnings) {
      warnings.push({
        id: assetPreview.id,
        rowNumber: w.rowIndex,
        message: w.message,
      });
    }

    // Collect errors (malformed cells — non-int qty, bad enum, etc.).
    // These fail the row's qty + assetModel update only; other cells
    // (name, category, …) still apply.
    for (const e of parsed.errors) {
      failed.push({
        id: assetPreview.id,
        title: assetPreview.title,
        rowNumber: e.rowIndex,
        error: e.message,
      });
    }
    // If the parser errored, skip queuing this asset's patch entirely.
    if (parsed.errors.length > 0) continue;

    qtyPatchesByAssetDbId.set(assetPreview.assetDbId, parsed.patch);

    if (parsed.patch.assetModelLookupKey) {
      assetModelNamesToResolve.add(parsed.patch.assetModelLookupKey);
    }
  }

  // Batch-resolve every distinct INDIVIDUAL assetModel name (creates
  // missing models on the fly). The parser already filtered out the
  // qty-tracked rows, so the names here are guaranteed safe to apply.
  const assetModelNameToId =
    assetModelNamesToResolve.size > 0
      ? await batchResolveAssetModelNames(
          [...assetModelNamesToResolve],
          userId,
          organizationId
        )
      : new Map<string, string>();

  for (const assetPreview of diffs.assetsToUpdate) {
    const { id: matchId, assetDbId, title: assetTitle, changes } = assetPreview;
    // Look up in primary map first, then fallback (matches computeAssetDiffs logic)
    const existingAsset =
      existingAssets.get(matchId) ?? fallbackAssets?.get(matchId);
    if (!existingAsset) {
      // Asset was deleted between preview and apply
      const rowIdx = seenIdsForRow.get(matchId);
      failed.push({
        id: matchId,
        title: assetTitle,
        rowNumber: rowIdx !== undefined ? rowIdx + 2 : 0,
        error:
          "Asset no longer exists — it may have been deleted after the preview",
      });
      continue;
    }
    const rowIdx = seenIdsForRow.get(matchId);
    const rowNumber = rowIdx !== undefined ? rowIdx + 2 : 0;

    try {
      // Separate location changes to handle kit constraint gracefully
      let locationChange: FieldChange | undefined;
      let locationKitError: string | undefined;
      let availableToBookChange: FieldChange | undefined;
      const otherChanges: FieldChange[] = [];

      for (const change of changes) {
        // Skip fields with validation warnings (e.g. bad date format,
        // assetModel-on-qty-tracked, invalid enum) AND forward the
        // warning text into `result.warnings` so the user sees the
        // field-level reason in the yellow "Warnings" pill — not just
        // the row-level "N fields had invalid values" summary.
        if (change.warning) {
          warnings.push({
            id: matchId,
            rowNumber,
            message: `${change.field}: ${change.warning}`,
          });
          continue;
        }

        // Match by field display name
        const col = headerAnalysis.updatableColumns.find(
          (c) => c.csvHeader === change.field
        );
        if (!col) continue;

        if (col.internalKey === "location") {
          locationChange = change;
        } else if (col.internalKey === "availableToBook") {
          availableToBookChange = change;
        } else {
          otherChanges.push(change);
        }
      }

      // Build update payload fields from non-location, non-availableToBook changes
      let title: UpdateAssetPayload["title"];
      let categoryId: UpdateAssetPayload["categoryId"];
      let tags: UpdateAssetPayload["tags"];
      let valuation: UpdateAssetPayload["valuation"];
      // Wave-1 update-path extension — qty-tracked + AssetModel fields.
      // Populated from `qtyPatchesByAssetDbId` (parsed in the pre-pass)
      // and the assetModel lookup map.
      let quantityPatch: UpdateAssetPayload["quantity"];
      let minQuantityPatch: UpdateAssetPayload["minQuantity"];
      let unitOfMeasurePatch: UpdateAssetPayload["unitOfMeasure"];
      let consumptionTypePatch: UpdateAssetPayload["consumptionType"];
      let assetModelIdPatch: UpdateAssetPayload["assetModelId"];
      const customFieldsValues: {
        id: string;
        value: ICustomFieldValueJson;
      }[] = [];

      // Pull this asset's qty-tracked patch (may be undefined if no
      // qty-tracked columns were present in the CSV at all).
      const qtyPatch = qtyPatchesByAssetDbId.get(assetDbId);
      if (qtyPatch) {
        // Only apply qty fields that actually changed vs the existing
        // asset — preserves the "skip no-op cells" behaviour the rest
        // of the apply loop already exhibits.
        if (
          qtyPatch.quantity !== undefined &&
          qtyPatch.quantity !== (existingAsset.quantity ?? undefined)
        ) {
          quantityPatch = qtyPatch.quantity;
        }
        if (
          qtyPatch.minQuantity !== undefined &&
          qtyPatch.minQuantity !== (existingAsset.minQuantity ?? undefined)
        ) {
          minQuantityPatch = qtyPatch.minQuantity;
        }
        if (
          qtyPatch.unitOfMeasure !== undefined &&
          qtyPatch.unitOfMeasure !== (existingAsset.unitOfMeasure ?? undefined)
        ) {
          unitOfMeasurePatch = qtyPatch.unitOfMeasure;
        }
        if (
          qtyPatch.consumptionType !== undefined &&
          qtyPatch.consumptionType !==
            (existingAsset.consumptionType ?? undefined)
        ) {
          consumptionTypePatch = qtyPatch.consumptionType;
        }
        // assetModelId — resolve lookup key via batch map; skip no-op.
        if (qtyPatch.assetModelLookupKey) {
          const resolved = assetModelNameToId.get(qtyPatch.assetModelLookupKey);
          if (resolved && resolved !== existingAsset.assetModelId) {
            assetModelIdPatch = resolved;
          }
        }
      }

      for (const change of otherChanges) {
        const col = headerAnalysis.updatableColumns.find(
          (c) => c.csvHeader === change.field
        );
        if (!col) continue;

        switch (col.internalKey) {
          case "name":
            title = change.newValue;
            break;

          case "category": {
            if (change.clearing) {
              // Clear category by setting to "uncategorized" sentinel
              categoryId = "uncategorized";
            } else {
              const resolvedCategoryId = categoryNameMap.get(change.newValue);
              if (resolvedCategoryId) {
                categoryId = resolvedCategoryId;
              }
            }
            break;
          }

          case "tags": {
            if (change.clearing) {
              // Clear all tags
              tags = { set: [] };
            } else {
              const tagNames = change.newValue
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              const tagIds = tagNames
                .map((n) => tagNameMap.get(n.toLowerCase()))
                .filter((id): id is string => !!id)
                .map((id) => ({ id }));
              tags = { set: tagIds };
            }
            break;
          }

          case "valuation": {
            if (change.clearing) {
              // Clear valuation by setting to 0
              valuation = 0;
            } else {
              const normalized = normalizeExportedCurrencyValue(
                change.newValue
              );
              const val = Number(normalized);
              if (Number.isFinite(val)) {
                valuation = val;
              }
            }
            break;
          }

          // Qty-tracked + AssetModel "changes" are routed via the
          // pre-pass-populated `qtyPatch` above — they're already
          // validated and resolved. Skip here so we don't double-apply
          // or treat them as unrecognised core fields.
          case "quantity":
          case "minQuantity":
          case "unitOfMeasure":
          case "consumptionType":
          case "assetModel":
          case "type":
            break;

          default: {
            // Custom field
            if (col.kind === "customField" && col.cfDef) {
              const fullCf = cfByName.get(col.cfDef.name.toLowerCase());
              if (fullCf) {
                if (change.clearing) {
                  // Clear custom field by passing empty value
                  // buildCustomFieldValue returns undefined for empty,
                  // which signals deletion in updateAsset
                  customFieldsValues.push({
                    id: fullCf.id,
                    value: { raw: "" },
                  });
                } else {
                  // For AMOUNT/NUMBER fields, pre-normalize and validate
                  let rawValue: string = change.newValue;
                  if (fullCf.type === "AMOUNT" || fullCf.type === "NUMBER") {
                    rawValue = normalizeExportedCurrencyValue(rawValue);
                    // Skip if not a valid finite number (matches preview logic)
                    if (!Number.isFinite(Number(rawValue))) continue;
                  }

                  const builtValue = buildCustomFieldValue(
                    { raw: rawValue },
                    fullCf
                  );
                  if (builtValue) {
                    customFieldsValues.push({
                      id: fullCf.id,
                      value: builtValue,
                    });
                  }
                }
              }
            }
            break;
          }
        }
      }

      // Count actual payload fields (not otherChanges.length, which may include
      // fields that were silently skipped like invalid numbers)
      let changesApplied = 0;
      if (title !== undefined) changesApplied++;
      if (categoryId !== undefined) changesApplied++;
      if (tags !== undefined) changesApplied++;
      if (valuation !== undefined) changesApplied++;
      if (quantityPatch !== undefined) changesApplied++;
      if (minQuantityPatch !== undefined) changesApplied++;
      if (unitOfMeasurePatch !== undefined) changesApplied++;
      if (consumptionTypePatch !== undefined) changesApplied++;
      if (assetModelIdPatch !== undefined) changesApplied++;
      changesApplied += customFieldsValues.length;

      const hasMainChanges =
        title !== undefined ||
        categoryId !== undefined ||
        tags !== undefined ||
        valuation !== undefined ||
        quantityPatch !== undefined ||
        minQuantityPatch !== undefined ||
        unitOfMeasurePatch !== undefined ||
        consumptionTypePatch !== undefined ||
        assetModelIdPatch !== undefined ||
        customFieldsValues.length > 0;

      if (hasMainChanges) {
        const payload: UpdateAssetPayload = {
          id: assetDbId,
          userId,
          organizationId,
          request,
          title,
          categoryId,
          tags,
          valuation,
          // Wave-1 qty-tracked + AssetModel patches. `updateAsset`
          // already accepts these (see `UpdateAssetPayload`); the
          // service-layer guards re-validate type-vs-cell compatibility.
          quantity: quantityPatch,
          minQuantity: minQuantityPatch,
          unitOfMeasure: unitOfMeasurePatch,
          consumptionType: consumptionTypePatch,
          assetModelId: assetModelIdPatch,
          customFieldsValues:
            customFieldsValues.length > 0
              ? (customFieldsValues as UpdateAssetPayload["customFieldsValues"])
              : undefined,
        };
        await updateAsset(payload);
      }

      // Handle location separately to catch kit constraint
      if (locationChange) {
        try {
          if (locationChange.clearing) {
            // Clear location by setting newLocationId to null
            const locationPayload: UpdateAssetPayload = {
              id: assetDbId,
              userId,
              organizationId,
              request,
              newLocationId: null,
              currentLocationId: existingAsset.location?.id ?? undefined,
            };
            await updateAsset(locationPayload);
            changesApplied++;
          } else {
            const locationId = locationNameMap.get(locationChange.newValue);
            if (!locationId) {
              throw new ShelfError({
                cause: null,
                message: `Location "${locationChange.newValue}" could not be resolved`,
                label: "Assets",
                shouldBeCaptured: false,
              });
            }
            const locationPayload: UpdateAssetPayload = {
              id: assetDbId,
              userId,
              organizationId,
              request,
              newLocationId: locationId,
              currentLocationId: existingAsset.location?.id ?? undefined,
            };
            await updateAsset(locationPayload);
            changesApplied++;
          }
        } catch (cause) {
          // If location fails due to kit constraint, track it but continue.
          // The kit constraint error sets additionalData.kitId.
          const isKitConstraint =
            isLikeShelfError(cause) &&
            !!(cause as ShelfError).additionalData?.kitId;
          if (!isKitConstraint) {
            throw cause; // Re-throw non-kit errors
          }
          const msg = (cause as ShelfError).message;
          locationKitError = `Location change skipped: ${msg}`;
        }
      }

      // Handle availableToBook separately to avoid outer catch
      // masking earlier successful writes as a full-row failure
      if (availableToBookChange) {
        try {
          const newBool = parseYesNo(availableToBookChange.newValue);
          if (newBool !== undefined) {
            await updateAssetBookingAvailability({
              id: assetDbId,
              availableToBook: newBool,
              organizationId,
            });
            changesApplied++;
          }
        } catch (cause) {
          const msg = isLikeShelfError(cause)
            ? (cause as ShelfError).message
            : "Booking availability update failed";
          // Track as partial failure if other fields already applied
          if (changesApplied > 0 || hasMainChanges) {
            locationKitError =
              locationKitError || `Available-to-book change skipped: ${msg}`;
          } else {
            throw cause;
          }
        }
      }

      if (changesApplied > 0) {
        updated.push({
          id: matchId,
          title: assetTitle,
          changesApplied,
        });
        // If location failed due to kit but other fields succeeded,
        // record as a separate failure entry (partial success)
        if (locationKitError) {
          failed.push({
            id: matchId,
            title: assetTitle,
            rowNumber,
            error: locationKitError,
          });
        }
      } else if (locationKitError) {
        // Only change was location and it failed
        failed.push({
          id: matchId,
          title: assetTitle,
          rowNumber,
          error: locationKitError,
        });
      } else {
        // All changes had warnings — nothing applied
        const warnedCount = changes.filter((c) => c.warning).length;
        if (warnedCount > 0) {
          skipped.push({
            id: matchId,
            title: assetTitle,
            reason: `${warnedCount} field${
              warnedCount !== 1 ? "s" : ""
            } had invalid values and were skipped`,
          });
        }
      }
    } catch (cause) {
      // `updateAsset` wraps unexpected database errors in a *generic* ShelfError
      // ("We could not create or update this Asset…") whose own message hides the
      // real reason, and that wrapper is not captured to Sentry. For a bulk import
      // that means a row can fail with zero diagnosable signal. So we (a) capture
      // the failure (with its full cause chain) to Sentry, scoped to this feature,
      // and (b) surface the underlying reason in the per-row report message.
      Logger.error(
        new ShelfError({
          cause,
          message: "Bulk asset update: row failed to apply",
          additionalData: { matchId, rowNumber, organizationId, userId },
          label: "Assets",
          shouldBeCaptured: true,
        })
      );
      failed.push({
        id: matchId,
        title: assetTitle,
        rowNumber,
        error: describeBulkUpdateRowFailure(cause),
      });
    }
  }

  // Count unique assets — some may appear in both updated and failed
  // when a partial success occurs (e.g. location kit constraint)
  const uniqueIds = new Set([
    ...updated.map((a) => a.id),
    ...skipped.map((a) => a.id),
    ...failed.map((r) => r.id),
  ]);
  const total = uniqueIds.size;

  return {
    updated,
    skipped,
    failed,
    warnings,
    summary: {
      total,
      updated: updated.length,
      skipped: skipped.length,
      failed: failed.length,
    },
  };
}
