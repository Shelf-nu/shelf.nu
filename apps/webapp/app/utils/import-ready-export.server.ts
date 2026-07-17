/**
 * Import-ready asset CSV export.
 *
 * Turns `AdvancedIndexAsset[]` into a CSV whose headers are literally the
 * content-importer's keys (`title`, `type`, `cf:Name,type:TYPE`, `barcode_*`)
 * and whose values are importer-native — so the file re-imports cleanly into
 * another workspace via the "Import assets" flow.
 *
 * Contrast with the human/analytics export in `csv.server.ts`, which uses
 * display labels, currency-formatted values, and a synthetic `total_value`
 * column that the importer cannot parse.
 *
 * @see {@link file://./../modules/asset/utils.server.ts} ASSET_CSV_HEADERS (allow-list)
 * @see {@link file://./import.server.ts} extractCSVDataFromContentImport (validator)
 * @see {@link file://./custom-fields.ts} buildCustomFieldValue (value parser)
 */
import type { CustomField } from "@prisma/client";
import { AssetType, CustomFieldType } from "@prisma/client";
import type {
  AdvancedIndexAsset,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import {
  barcodeFields,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import { getPrimaryCustody } from "~/modules/custody/utils";
import { cleanMarkdownFormatting } from "~/utils/markdown-cleaner";
import { resolveTeamMemberName } from "~/utils/user";

/** Whether to export every importable column or only the ones the user sees. */
export type ColumnScope = "visible" | "all";

/** Core (non-custom-field, non-barcode) importer fields. */
export type CoreImportField =
  | "title"
  | "description"
  | "category"
  | "kit"
  | "tags"
  | "location"
  | "custodian"
  | "bookable"
  | "valuation"
  | "assetModel"
  | "type"
  | "quantity"
  | "minQuantity"
  | "unitOfMeasure"
  | "consumptionType";

/** A resolved output column: its header plus how to extract its value. */
export type ImportColumn =
  | { kind: "core"; header: string; field: CoreImportField }
  | { kind: "barcode"; header: string; barcodeType: string }
  | { kind: "cf"; header: string; name: string; cfType: CustomFieldType };

/**
 * Canonical core-field order. `columnName` is the settings column that gates
 * inclusion in "visible" scope; `alwaysInclude` marks fields required to
 * reconstruct an asset (so a "visible" export still imports quantity-tracked
 * rows, which need `type`/`quantity`/`consumptionType`).
 *
 * `qrId` (org-scoped) and `imageUrl` (v1: skipped) are deliberately absent.
 */
const CORE_IMPORT_FIELDS: Array<{
  header: string;
  field: CoreImportField;
  columnName?: Column["name"];
  alwaysInclude?: boolean;
}> = [
  { header: "title", field: "title", columnName: "name", alwaysInclude: true },
  { header: "description", field: "description", columnName: "description" },
  { header: "category", field: "category", columnName: "category" },
  { header: "kit", field: "kit", columnName: "kit" },
  { header: "tags", field: "tags", columnName: "tags" },
  { header: "location", field: "location", columnName: "location" },
  { header: "custodian", field: "custodian", columnName: "custody" },
  { header: "bookable", field: "bookable", columnName: "availableToBook" },
  { header: "valuation", field: "valuation", columnName: "valuation" },
  { header: "assetModel", field: "assetModel", columnName: "assetModel" },
  { header: "type", field: "type", columnName: "type", alwaysInclude: true },
  {
    header: "quantity",
    field: "quantity",
    columnName: "quantity",
    alwaysInclude: true,
  },
  { header: "minQuantity", field: "minQuantity", alwaysInclude: true },
  { header: "unitOfMeasure", field: "unitOfMeasure", alwaysInclude: true },
  { header: "consumptionType", field: "consumptionType", alwaysInclude: true },
];

/** Arguments for {@link buildImportReadyColumns}. */
export type BuildImportReadyColumnsArgs = {
  columnScope: ColumnScope;
  settingsColumns: Column[];
  activeCustomFields: Array<Pick<CustomField, "name" | "type">>;
  barcodesEnabled: boolean;
};

/**
 * Builds the ordered list of importer-native output columns.
 *
 * @param args - Scope, the user's column settings, active custom fields, and
 *   whether barcodes are enabled for the workspace.
 * @returns Ordered {@link ImportColumn}s (core → barcodes → custom fields).
 */
export function buildImportReadyColumns({
  columnScope,
  settingsColumns,
  activeCustomFields,
  barcodesEnabled,
}: BuildImportReadyColumnsArgs): ImportColumn[] {
  const visibleColumnNames = new Set(
    settingsColumns.filter((c) => c.visible).map((c) => c.name)
  );
  const includeAll = columnScope === "all";

  const columns: ImportColumn[] = [];

  for (const f of CORE_IMPORT_FIELDS) {
    const include =
      includeAll ||
      f.alwaysInclude ||
      (f.columnName ? visibleColumnNames.has(f.columnName) : false);
    if (include) {
      columns.push({ kind: "core", header: f.header, field: f.field });
    }
  }

  if (barcodesEnabled) {
    for (const bf of barcodeFields) {
      if (includeAll || visibleColumnNames.has(bf)) {
        columns.push({
          kind: "barcode",
          header: bf,
          barcodeType: bf.replace("barcode_", ""),
        });
      }
    }
  }

  for (const cf of activeCustomFields) {
    const columnName = `cf_${cf.name}` as Column["name"];
    if (includeAll || visibleColumnNames.has(columnName)) {
      columns.push({
        kind: "cf",
        header: `cf:${cf.name},type:${cf.type}`,
        name: cf.name,
        cfType: cf.type,
      });
    }
  }

  return columns;
}

/**
 * Encodes a custom-field value in the exact form the content importer expects
 * (see `buildCustomFieldValue` in `~/utils/custom-fields.ts`). Notably
 * AMOUNT/NUMBER are plain numbers — the human export currency-formats them,
 * which would NOT re-import.
 *
 * @param value - The stored custom-field value object (may be absent when the
 *   asset has no value recorded for this field).
 * @param cfType - The field's type, used to pick the importer-native encoding.
 * @returns The importer-native string (empty when unset).
 */
function encodeCustomFieldForImport(
  value: ShelfAssetCustomFieldValueType["value"] | undefined,
  cfType: CustomFieldType
): string {
  // `value` is guaranteed present past this guard, so the per-case checks below
  // read its fields directly (no redundant `value &&`).
  if (!value) return "";

  switch (cfType) {
    case CustomFieldType.BOOLEAN: {
      // Nothing stored at all → emit blank so re-import leaves it unset.
      if (value.valueBoolean === undefined && value.raw == null) return "";
      // Prefer the parsed boolean; fall back to interpreting `raw` for older or
      // partial records that only kept the raw value (e.g. `true` / "yes").
      const bool =
        value.valueBoolean ??
        (typeof value.raw === "boolean"
          ? value.raw
          : ["yes", "true"].includes(String(value.raw).trim().toLowerCase()));
      return bool ? "Yes" : "No";
    }
    case CustomFieldType.DATE:
      // buildCustomFieldValue stores `raw` as the YYYY-MM-DD string.
      return typeof value.raw === "string" ? value.raw : "";
    case CustomFieldType.MULTILINE_TEXT:
      return cleanMarkdownFormatting(String(value.raw ?? ""));
    case CustomFieldType.AMOUNT:
    case CustomFieldType.NUMBER:
      return value.raw != null ? String(value.raw) : "";
    case CustomFieldType.OPTION:
    default:
      return value.raw != null ? String(value.raw) : "";
  }
}

/**
 * Extracts the importer-native value for a single output column of an asset.
 *
 * @param col - The output column descriptor.
 * @param asset - The asset row.
 * @returns The cell value as a raw (unquoted) string.
 */
export function resolveImportReadyCell(
  col: ImportColumn,
  asset: AdvancedIndexAsset
): string {
  switch (col.kind) {
    case "core":
      return resolveCoreField(col.field, asset);
    case "barcode":
      return (asset.barcodes ?? [])
        .filter((b) => b.type === col.barcodeType)
        .map((b) => b.value)
        .join(",");
    case "cf": {
      const entry = asset.customFields?.find(
        (e) => e.customField.name === col.name
      );
      return encodeCustomFieldForImport(
        entry?.value as unknown as
          | ShelfAssetCustomFieldValueType["value"]
          | undefined,
        col.cfType
      );
    }
  }
}

/** Extracts a core field value in importer-native form. */
function resolveCoreField(
  field: CoreImportField,
  asset: AdvancedIndexAsset
): string {
  switch (field) {
    case "title":
      return asset.title ?? "";
    case "description":
      return asset.description ?? "";
    case "category":
      return asset.category?.name ?? ""; // NOT "Uncategorized" — importer needs a real name or blank
    case "kit":
      return asset.kit?.name ?? "";
    case "tags":
      return (asset.tags ?? []).map((t) => t.name).join(",");
    case "location":
      return asset.location?.name ?? "";
    case "custodian": {
      const primary = getPrimaryCustody(asset.custody);
      return primary ? resolveTeamMemberName(primary.custodian) : "";
    }
    case "bookable":
      return asset.availableToBook ? "yes" : "no";
    case "valuation":
      return asset.valuation != null ? String(asset.valuation) : "";
    case "assetModel":
      return asset.assetModelName ?? "";
    case "type":
      return asset.type ?? "";
    case "quantity":
      // Only quantity-tracked assets carry a meaningful quantity. Emitting a
      // quantity > 1 for an INDIVIDUAL asset would make the file fail its own
      // re-import (the importer rejects INDIVIDUAL quantity > 1); INDIVIDUAL
      // rows re-import fine with a blank quantity (the importer defaults to 1).
      return asset.type === AssetType.QUANTITY_TRACKED && asset.quantity != null
        ? String(asset.quantity)
        : "";
    case "minQuantity":
      return asset.minQuantity != null ? String(asset.minQuantity) : "";
    case "unitOfMeasure":
      return asset.unitOfMeasure ?? "";
    case "consumptionType":
      return asset.consumptionType ?? "";
  }
}

/** Arguments for {@link buildImportReadyRows} / {@link buildImportReadyCsvFromAssets}. */
export type BuildImportReadyCsvArgs = BuildImportReadyColumnsArgs & {
  assets: AdvancedIndexAsset[];
};

/**
 * Builds the raw (unquoted) CSV matrix: header row followed by one row per
 * asset. Returned as `string[][]` so it can be fed straight into the importer
 * validator for round-trip tests.
 *
 * @param args - Scope, column settings, active custom fields, barcode flag, assets.
 * @returns `[headerRow, ...dataRows]`.
 */
export function buildImportReadyRows(
  args: BuildImportReadyCsvArgs
): string[][] {
  const columns = buildImportReadyColumns(args);
  const headerRow = columns.map((c) => c.header);
  const dataRows = args.assets.map((asset) =>
    columns.map((col) => resolveImportReadyCell(col, asset))
  );
  return [headerRow, ...dataRows];
}

/** Wraps a cell in double quotes, escaping embedded quotes (RFC 4180). */
function quoteCsvCell(value: string): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * Builds the final import-ready CSV string (comma-delimited, every cell
 * double-quoted, CRLF line endings).
 *
 * @param args - Scope, column settings, active custom fields, barcode flag, assets.
 * @returns The CSV file contents.
 */
export function buildImportReadyCsvFromAssets(
  args: BuildImportReadyCsvArgs
): string {
  return buildImportReadyRows(args)
    .map((row) => row.map(quoteCsvCell).join(","))
    .join("\r\n");
}
