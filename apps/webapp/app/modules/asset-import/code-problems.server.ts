/**
 * Row-level QR code and barcode checks for an asset import file.
 *
 * Reports every QR code and barcode problem in a file as one row error per
 * affected row, so the upload step lists them together with the other row
 * problems instead of stopping at the first bad code. Read-only: nothing is
 * claimed, linked or created.
 *
 * The rules match what the importer enforces when it writes
 * (`validateImportQrCodes` and `parseBarcodesFromImportData`), which keep
 * guarding the admin importer and the chunk writer.
 *
 * @see {@link file://./validate.server.ts}
 * @see {@link file://../qr/service.server.ts} `validateImportQrCodes`
 * @see {@link file://../barcode/service.server.ts} `parseBarcodesFromImportData`
 */
import type { BarcodeType, Organization } from "@prisma/client";
import { db } from "~/database/db.server";
import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import { BARCODE_IMPORT_COLUMNS } from "~/modules/barcode/service.server";
import {
  normalizeBarcodeValue,
  validateBarcodeValue,
} from "~/modules/barcode/validation";
import { decodeCsvListCell } from "~/utils/csv-cells";
import {
  type ImportRowError,
  spreadsheetRowNumber,
} from "~/utils/import-row-errors";

/** One barcode value as it appears on one row of the file. */
type BarcodeOccurrence = {
  row: number;
  type: BarcodeType;
  /** The value as the importer stores it (see `normalizeBarcodeValue`). */
  value: string;
};

/**
 * Formats a list of spreadsheet rows for a message: "row 3", "rows 3 and 5",
 * "rows 3, 5 and 9".
 *
 * @param rows - Spreadsheet row numbers, in file order
 * @returns The rows as a phrase
 */
function describeRows(rows: number[]): string {
  if (rows.length === 1) {
    return `row ${rows[0]}`;
  }
  const head = rows.slice(0, -1).join(", ");
  return `rows ${head} and ${rows[rows.length - 1]}`;
}

/**
 * Reads a cell as a non-blank string.
 *
 * @param value - The parsed cell
 * @returns The cell when it is a string with content, otherwise `null`
 */
function filledCell(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Finds every QR code and barcode problem in an import file.
 *
 * QR codes: a code used on more than one row (every row involved is
 * reported), a code that does not exist, a code already linked to an asset or
 * kit, and a code that belongs to another workspace. Barcodes, only when the
 * workspace has the add-on: a value its type does not accept, a value used
 * more than once in the file (every row involved), and a value already linked
 * to an asset or kit in this workspace.
 *
 * @param args.data - Parsed import rows
 * @param args.organizationId - Workspace the import targets
 * @param args.canUseBarcodes - Whether the workspace has the barcodes add-on.
 *   When false the barcode columns are not checked here; the caller refuses
 *   them as a whole.
 * @returns One error per problem per row, ordered by row
 */
export async function collectImportCodeProblems({
  data,
  organizationId,
  canUseBarcodes,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
  canUseBarcodes: boolean;
}): Promise<ImportRowError[]> {
  const errors: ImportRowError[] = [
    ...(await collectQrCodeProblems({ data, organizationId })),
  ];

  if (canUseBarcodes) {
    errors.push(...(await collectBarcodeProblems({ data, organizationId })));
  }

  // `sort` is stable, so the problems of one row keep their check order.
  return errors.sort((a, b) => a.row - b.row);
}

/**
 * The QR code half of {@link collectImportCodeProblems}.
 *
 * @param args.data - Parsed import rows
 * @param args.organizationId - Workspace the import targets
 * @returns One error per QR code problem per row
 */
async function collectQrCodeProblems({
  data,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
}): Promise<ImportRowError[]> {
  const rowsByQrId = new Map<string, number[]>();
  for (const [index, asset] of data.entries()) {
    const qrId = filledCell(asset.qrId);
    if (!qrId) {
      continue;
    }
    const rows = rowsByQrId.get(qrId) ?? [];
    rows.push(spreadsheetRowNumber(index));
    rowsByQrId.set(qrId, rows);
  }

  if (rowsByQrId.size === 0) {
    return [];
  }

  const codes = await db.qr.findMany({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: the check deliberately fetches codes across orgs so it can detect and REPORT codes that belong to another organization; nothing is returned to the caller beyond that fact, and scoping to organizationId would hide foreign codes instead of flagging them
    where: { id: { in: [...rowsByQrId.keys()] } },
    select: { id: true, assetId: true, kitId: true, organizationId: true },
  });
  const codeById = new Map(codes.map((code) => [code.id, code]));

  const errors: ImportRowError[] = [];
  for (const [qrId, rows] of rowsByQrId) {
    if (rows.length > 1) {
      for (const row of rows) {
        const others = rows.filter((other) => other !== row);
        errors.push({
          row,
          title: "Duplicate QR code",
          message: `QR code "${qrId}" is also used on ${describeRows(
            others
          )}. Each QR code can be linked to one asset only.`,
        });
      }
    }

    const code = codeById.get(qrId);
    let problem: Pick<ImportRowError, "title" | "message"> | null = null;
    // Another workspace's code is reported as such even when it is linked
    // there: that asset is not one the importer can see or act on.
    if (!code) {
      problem = {
        title: "QR code not found",
        message: `QR code "${qrId}" does not exist. Check the qrId column, or leave it empty to generate a new code.`,
      };
    } else if (code.organizationId && code.organizationId !== organizationId) {
      problem = {
        title: "QR code from another workspace",
        message: `QR code "${qrId}" belongs to another workspace. Use a code from this workspace or an unclaimed code, or leave the qrId column empty to generate a new code.`,
      };
    } else if (code.assetId || code.kitId) {
      problem = {
        title: "QR code already in use",
        message: `QR code "${qrId}" is already linked to ${
          code.assetId ? "an asset" : "a kit"
        }. Use an unlinked code, or leave the qrId column empty to generate a new code.`,
      };
    }

    if (problem) {
      for (const row of rows) {
        errors.push({ row, ...problem });
      }
    }
  }

  return errors;
}

/**
 * The barcode half of {@link collectImportCodeProblems}.
 *
 * @param args.data - Parsed import rows
 * @param args.organizationId - Workspace the import targets
 * @returns One error per barcode problem per row
 */
async function collectBarcodeProblems({
  data,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
}): Promise<ImportRowError[]> {
  const errors: ImportRowError[] = [];
  const occurrencesByValue = new Map<string, BarcodeOccurrence[]>();

  for (const [index, asset] of data.entries()) {
    const row = spreadsheetRowNumber(index);
    for (const { column, type } of BARCODE_IMPORT_COLUMNS) {
      const cellValue = filledCell(asset[column]);
      if (!cellValue) {
        continue;
      }
      // One cell may carry several barcodes of this type, read back
      // quote-aware exactly as the importer reads them.
      for (const rawValue of decodeCsvListCell(cellValue)) {
        const value = normalizeBarcodeValue(type, rawValue);
        const validationError = validateBarcodeValue(type, value);
        if (validationError) {
          errors.push({
            row,
            title: "Invalid barcode",
            message: `${type} barcode "${rawValue}" is not valid: ${validationError}`,
          });
          continue;
        }
        const occurrences = occurrencesByValue.get(value) ?? [];
        occurrences.push({ row, type, value });
        occurrencesByValue.set(value, occurrences);
      }
    }
  }

  for (const [value, occurrences] of occurrencesByValue) {
    if (occurrences.length < 2) {
      continue;
    }
    const rows = [...new Set(occurrences.map(({ row }) => row))];
    for (const row of rows) {
      const others = rows.filter((other) => other !== row);
      errors.push({
        row,
        title: "Duplicate barcode",
        message:
          others.length > 0
            ? `Barcode "${value}" is also used on ${describeRows(
                others
              )}. Each barcode must be unique.`
            : `Barcode "${value}" appears more than once on this row. Each barcode must be unique.`,
      });
    }
  }

  if (occurrencesByValue.size === 0) {
    return errors;
  }

  const linkedBarcodes = await db.barcode.findMany({
    where: {
      value: { in: [...occurrencesByValue.keys()] },
      organizationId,
      OR: [{ assetId: { not: null } }, { kitId: { not: null } }],
    },
    select: {
      value: true,
      asset: { select: { title: true } },
      kit: { select: { name: true } },
    },
  });

  for (const barcode of linkedBarcodes) {
    const linkedTo = barcode.asset
      ? `asset "${barcode.asset.title}"`
      : `kit "${barcode.kit?.name ?? "Unknown kit"}"`;
    const rows = new Set(
      (occurrencesByValue.get(barcode.value) ?? []).map(({ row }) => row)
    );
    for (const row of rows) {
      errors.push({
        row,
        title: "Barcode already in use",
        message: `Barcode "${
          barcode.value
        }" is already linked to ${linkedTo} in this workspace. Use a different barcode, or remove it from that ${
          barcode.asset ? "asset" : "kit"
        } first.`,
      });
    }
  }

  return errors;
}
