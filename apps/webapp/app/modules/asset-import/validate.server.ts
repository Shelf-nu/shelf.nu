/**
 * Read-only validation of an asset import file.
 *
 * Runs every check the importer applies before it writes anything, without
 * creating or claiming anything. Row rules and QR code and barcode problems are
 * gathered into one list of row errors, so a single upload shows the user
 * everything they have to fix. The barcode add-on gate and the kit custody
 * check follow. The upload step calls it so a bad file is refused before a
 * draft exists.
 *
 * @see {@link file://./code-problems.server.ts}
 * @see {@link file://./missing-entities.server.ts}
 * @see {@link file://../asset/import-preflight.server.ts}
 */
import type { Organization, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { validateContentImportRows } from "~/modules/asset/import-preflight.server";
import { validateKitCustodyConflicts } from "~/modules/asset/service.server";
import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import { importDataHasBarcodes } from "~/modules/barcode/service.server";
import { ShelfError } from "~/utils/error";
import { MAX_REPORTED_ROW_ERRORS } from "~/utils/import-row-errors";
import { collectImportCodeProblems } from "./code-problems.server";
import { MAX_BACKGROUND_IMPORT_ROWS } from "./constants";

/**
 * Validates a parsed import file without writing anything.
 *
 * @param args.data - Parsed import rows
 * @param args.organizationId - Workspace the import targets
 * @param args.userId - User running the import (recorded in error data)
 * @param args.canUseBarcodes - Whether the workspace has the barcodes add-on
 * @throws {ShelfError} 400 with `rowErrors` and `totalErrors` when any row or
 * QR code / barcode is invalid, 403 when the file has barcodes and the
 * workspace lacks the add-on, and the kit custody error of its own check
 */
export async function validateContentImportFile({
  data,
  organizationId,
  userId,
  canUseBarcodes,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
  userId: User["id"];
  canUseBarcodes?: boolean;
}): Promise<void> {
  // Matches on name and `deletedAt` and ignores `active`, like
  // `upsertCustomField`'s own lookup: filtering on active would miss a conflict
  // the importer goes on to reject.
  const existingCustomFields = await db.customField.findMany({
    where: { organizationId, deletedAt: null },
    select: { name: true, type: true },
  });

  const preflight = validateContentImportRows({
    data,
    existingCustomFields,
    maxRows: MAX_BACKGROUND_IMPORT_ROWS,
  });

  // A file over the row cap is refused on that alone (the preflight reports
  // only the cap), so its codes are not looked up.
  const codeProblems =
    data.length > MAX_BACKGROUND_IMPORT_ROWS
      ? []
      : await collectImportCodeProblems({
          data,
          organizationId,
          canUseBarcodes: Boolean(canUseBarcodes),
        });

  // The preflight list is already capped, so the total adds its own count to
  // the code problems. `sort` is stable: whole-file problems (row 0) lead and
  // each row keeps its check order.
  const totalErrors = preflight.totalErrors + codeProblems.length;
  const rowErrors = [...preflight.errors, ...codeProblems]
    .sort((a, b) => a.row - b.row)
    .slice(0, MAX_REPORTED_ROW_ERRORS);

  if (rowErrors.length > 0) {
    throw new ShelfError({
      cause: null,
      title: "Import file has errors",
      message: `Found ${totalErrors} problem${
        totalErrors === 1 ? "" : "s"
      } in your file. Nothing was imported. Fix the rows below and upload again.`,
      additionalData: {
        userId,
        organizationId,
        rowErrors,
        totalErrors,
      },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  // Uses the shared column list so a file carrying only ExternalQR/EAN13 is
  // refused too, rather than having those barcodes silently dropped.
  if (importDataHasBarcodes(data) && !canUseBarcodes) {
    throw new ShelfError({
      cause: null,
      message:
        "Your workspace doesn't have barcodes enabled. Please contact sales to learn more about barcodes.",
      additionalData: { userId, organizationId },
      label: "Assets",
      status: 403,
      shouldBeCaptured: false,
    });
  }

  await validateKitCustodyConflicts({ data, organizationId });
}
