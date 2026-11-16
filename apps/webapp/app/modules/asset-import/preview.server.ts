/**
 * Asset import preview builder.
 *
 * Turns an uploaded CSV into a stored DRAFT `AssetImport` plus the payload the
 * preview stage renders. Nothing is created in the workspace: the draft holds
 * the parsed rows (with pre-allocated asset ids) until the user confirms.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./validate.server.ts}
 * @see {@link file://./missing-entities.server.ts}
 * @see {@link file://./../../routes/api+/asset-imports.$importId.preview-rows.ts}
 */
import type { Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { getExternalQrValueWarning } from "~/modules/barcode/validation";
import { LEGACY_CUID_LENGTH } from "~/utils/constants";
import { decodeCsvListCell } from "~/utils/csv-cells";
import { ShelfError } from "~/utils/error";
import { id } from "~/utils/id/id.server";
import {
  MAX_REPORTED_ROW_ERRORS,
  spreadsheetRowNumber,
} from "~/utils/import-row-errors";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import { PREVIEW_DISPLAY_LIMIT } from "./constants";
import { findMissingImportEntities } from "./missing-entities.server";
import type {
  ContentImportPreview,
  ContentImportPreviewRowsPage,
  ImportGridCell,
  ImportGridRow,
  ImportNewEntities,
  ImportWarning,
  StoredImportRow,
} from "./types";
import { validateContentImportFile } from "./validate.server";

/** Columns whose cell is a single name that may be created by the import. */
const SINGLE_NAME_COLUMNS = {
  category: "categories",
  location: "locations",
  kit: "kits",
  custodian: "custodians",
  assetModel: "assetModels",
} as const satisfies Record<string, keyof ImportNewEntities>;

/** Column holding External QR values, a comma separated list per cell. */
const EXTERNAL_QR_COLUMN = "barcode_ExternalQR";

/**
 * Warnings for every value in an External QR cell, in cell order.
 *
 * @param raw - Stored cell value
 * @returns One warning text per flagged value; empty when the cell is fine
 */
function externalQrCellWarnings(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return decodeCsvListCell(raw).flatMap((value) => {
    const warning = getExternalQrValueWarning(value);
    return warning ? [warning] : [];
  });
}

/**
 * Collects value warnings over every stored row.
 *
 * @param rows - Stored import rows
 * @returns The first {@link MAX_REPORTED_ROW_ERRORS} warnings and the exact total
 */
export function collectValueWarnings(rows: StoredImportRow[]): {
  valueWarnings: ImportWarning[];
  totalValueWarnings: number;
} {
  const valueWarnings: ImportWarning[] = [];
  let totalValueWarnings = 0;
  for (const row of rows) {
    for (const message of externalQrCellWarnings(row[EXTERNAL_QR_COLUMN])) {
      totalValueWarnings += 1;
      if (valueWarnings.length < MAX_REPORTED_ROW_ERRORS) {
        valueWarnings.push({
          row: row.rowNumber,
          title: "External QR value",
          message,
        });
      }
    }
  }
  return { valueWarnings, totalValueWarnings };
}

/** Case-insensitive membership, matching how missing entities are detected. */
function includesName(names: string[], value: string): boolean {
  const wanted = value.trim().toLowerCase();
  return names.some((name) => name.toLowerCase() === wanted);
}

/**
 * Builds one grid cell, marking values the import will create.
 *
 * @param column - CSV column name
 * @param raw - Stored cell value (tags are a decoded list)
 * @param newEntities - Names the import will create
 */
function toGridCell(
  column: string,
  raw: unknown,
  newEntities: ImportNewEntities
): ImportGridCell {
  if (column === "tags") {
    const tags = Array.isArray(raw) ? (raw as string[]) : [];
    const hasNewTag = tags.some((tag) => includesName(newEntities.tags, tag));
    return hasNewTag
      ? { value: tags.join(", "), tone: "new", note: "Will be created" }
      : { value: tags.join(", "), tone: "plain" };
  }

  const value = raw === null || raw === undefined ? "" : String(raw);

  if (column in SINGLE_NAME_COLUMNS) {
    const kind =
      SINGLE_NAME_COLUMNS[column as keyof typeof SINGLE_NAME_COLUMNS];
    if (value.trim() && includesName(newEntities[kind], value)) {
      return { value, tone: "new", note: "Will be created" };
    }
  }

  if (column === EXTERNAL_QR_COLUMN) {
    const [warning] = externalQrCellWarnings(raw);
    if (warning) return { value, tone: "warning", note: warning };
  }

  return { value, tone: "plain" };
}

/**
 * Maps stored rows to the generic import grid, capped at `limit` rows.
 *
 * @param rows - Stored import rows
 * @param columns - Column names to render, in file order
 * @param newEntities - Names the import will create
 * @param limit - Maximum number of grid rows
 * @returns Grid rows labelled with their spreadsheet row number
 */
export function toImportGridRows(
  rows: StoredImportRow[],
  columns: string[],
  newEntities: ImportNewEntities,
  limit: number
): ImportGridRow[] {
  return rows.slice(0, limit).map((row) => ({
    key: row.key,
    label: String(row.rowNumber),
    cells: Object.fromEntries(
      columns.map((column) => [
        column,
        toGridCell(column, row[column], newEntities),
      ])
    ),
  }));
}

/**
 * Validates an uploaded CSV, stores it as a DRAFT import and returns the
 * preview payload. The user's older drafts in this workspace are replaced.
 *
 * @param args.csvData - Raw CSV records, header row first
 * @param args.fileName - Uploaded file name, if known
 * @param args.organizationId - Workspace the import targets
 * @param args.userId - User uploading the file
 * @param args.canUseBarcodes - Whether the workspace has the barcodes add-on
 * @returns The preview payload including the new draft's id
 * @throws {ShelfError} When headers or rows are invalid; nothing is stored
 */
export async function buildContentImportPreview({
  csvData,
  fileName,
  organizationId,
  userId,
  canUseBarcodes,
}: {
  csvData: string[][];
  fileName: string | null;
  organizationId: Organization["id"];
  userId: User["id"];
  canUseBarcodes: boolean;
}): Promise<ContentImportPreview> {
  const data = extractCSVDataFromContentImport(csvData, ASSET_CSV_HEADERS);

  await validateContentImportFile({
    data,
    organizationId,
    userId,
    canUseBarcodes,
  });
  const newEntities = await findMissingImportEntities({
    data,
    organizationId,
  });

  // The asset id is allocated now so a retried chunk writes the same asset.
  const rows: StoredImportRow[] = data.map((row, index) => ({
    ...row,
    assetId: id(LEGACY_CUID_LENGTH),
    rowNumber: spreadsheetRowNumber(index),
  }));

  const draft = await db.$transaction(async (tx) => {
    await tx.assetImport.deleteMany({
      where: { organizationId, createdById: userId, status: "DRAFT" },
    });
    return tx.assetImport.create({
      data: {
        status: "DRAFT",
        totalRows: rows.length,
        rows: rows as unknown as Prisma.InputJsonValue,
        fileName,
        canUseBarcodes,
        createdById: userId,
        organizationId,
      },
      select: { id: true },
    });
  });

  const columns = csvData[0].map((header) => header.trim()).filter(Boolean);

  return {
    importId: draft.id,
    fileName,
    totalRows: rows.length,
    columns,
    rows: toImportGridRows(rows, columns, newEntities, PREVIEW_DISPLAY_LIMIT),
    newEntities,
    ...collectValueWarnings(rows),
    counts: {
      withImage: rows.filter((row) => row.imageUrl?.trim()).length,
      withCustodian: rows.filter((row) => row.custodian?.trim()).length,
      inKit: rows.filter((row) => row.kit?.trim()).length,
      quantityTracked: rows.filter(
        (row) => row.type?.trim().toUpperCase() === "QUANTITY_TRACKED"
      ).length,
    },
  };
}

/** Keys a stored row carries that are not CSV columns. */
const NON_COLUMN_ROW_KEYS = new Set(["key", "assetId", "rowNumber", ""]);

/**
 * The CSV columns present on a stored row, in file order. A row stores one
 * key per header, so this is the preview's column list for that row.
 *
 * @param row - Stored import row
 * @returns Column names, without the keys the import adds
 */
function storedRowColumns(row: StoredImportRow): string[] {
  return Object.keys(row).filter((key) => !NON_COLUMN_ROW_KEYS.has(key));
}

/**
 * Reads one further page of preview grid rows from the viewer's DRAFT import.
 * The preview payload carries the first {@link PREVIEW_DISPLAY_LIMIT} rows;
 * "Load more" calls this with the number of rows already shown.
 *
 * Cells are marked against the workspace as it is now, so a name created
 * since the upload no longer shows as new.
 *
 * @param args.importId - The draft import
 * @param args.organizationId - Active workspace
 * @param args.userId - Viewer; only the user who uploaded a draft can read it
 * @param args.offset - Index of the first stored row to return
 * @returns Up to {@link PREVIEW_DISPLAY_LIMIT} grid rows and the offset of the
 *   next page, or `null` when this page reaches the end of the file
 * @throws {ShelfError} 404 when the draft is not the viewer's, not in this
 *   workspace, or no longer a draft
 */
export async function getContentImportPreviewRows({
  importId,
  organizationId,
  userId,
  offset,
}: {
  importId: string;
  organizationId: Organization["id"];
  userId: User["id"];
  offset: number;
}): Promise<ContentImportPreviewRowsPage> {
  const draft = await db.assetImport.findFirst({
    where: {
      id: importId,
      organizationId,
      createdById: userId,
      status: "DRAFT",
    },
    select: { rows: true },
  });

  if (!draft) {
    throw new ShelfError({
      cause: null,
      message: "Import not found. Upload the file again.",
      label: "Asset Import",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const rows = (draft.rows ?? []) as unknown as StoredImportRow[];
  const slice = rows.slice(offset, offset + PREVIEW_DISPLAY_LIMIT);
  const newEntities = await findMissingImportEntities({
    data: slice,
    organizationId,
  });
  const nextOffset = offset + slice.length;

  return {
    // Each row is mapped with its own columns; the grid looks cells up by
    // column name, so the client's column list decides what is shown.
    rows: slice.flatMap((row) =>
      toImportGridRows([row], storedRowColumns(row), newEntities, 1)
    ),
    nextOffset: nextOffset < rows.length ? nextOffset : null,
  };
}
