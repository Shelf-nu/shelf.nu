/**
 * Asset import chunk writer
 *
 * Writes one chunk of a background asset import (up to
 * `ASSET_IMPORT_CHUNK_SIZE` rows) in a single transaction, with one batch
 * statement per table. Each row ends up exactly as `createAsset` would leave
 * it: the asset with its sequential id, a QR code, tags, placement, kit pivot,
 * direct custody, custom field values, barcodes and one `ASSET_CREATED` event.
 * Kit custody is not written here: the FINALIZE step assigns it per kit.
 *
 * The first statement advances `AssetImport.processedRows` guarded on the
 * chunk's start, so a retried chunk that already committed writes nothing, and
 * a duplicate running at the same time waits on the row lock and then finds
 * the guard no longer matches.
 *
 * Pieces that changed in the workspace since the preview (a QR code linked
 * elsewhere, a barcode taken, a custom field deleted or retyped) never fail
 * the chunk: the row is imported without that piece and an `ImportWarning` is
 * stored on the import in the same transaction.
 *
 * @see {@link file://./../asset/service.server.ts} `createAsset`, the per-row equivalent
 * @see {@link file://./worker.server.ts} the job runner that calls this per chunk
 * @see {@link file://./types.ts}
 */
import type { BarcodeType, CustomField } from "@prisma/client";
import {
  AssetStatus,
  AssetType,
  ErrorCorrection,
  Prisma,
} from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { db } from "~/database/db.server";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { validateQtyTrackedFields } from "~/modules/asset/qty-validation.server";
import { getNextSequentialIds } from "~/modules/asset/sequential-id.server";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { resolveImportedAssetModel } from "~/modules/asset-model/service.server";
import { BARCODE_IMPORT_COLUMNS } from "~/modules/barcode/service.server";
import { normalizeBarcodeValue } from "~/modules/barcode/validation";
import { decodeCsvListCell } from "~/utils/csv-cells";
import {
  buildCustomFieldValue,
  getDefinitionFromCsvHeader,
} from "~/utils/custom-fields";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { id } from "~/utils/id/id.server";
import {
  assertAssetModelsBelongToOrg,
  assertCategoriesBelongToOrg,
  assertKitsBelongToOrg,
  assertLocationsBelongToOrg,
  assertTagsBelongToOrg,
  assertTeamMembersBelongToOrg,
} from "~/utils/org-validation.server";
import { MAX_STORED_IMPORT_WARNINGS } from "./constants";
import type {
  ImportWarning,
  ResolvedImportEntities,
  StoredImportRow,
} from "./types";

const label = "Asset Import";

/**
 * Transaction client the chunk is written through. The extended client's
 * `$transaction` callback param is not assignable to the generated
 * `Prisma.TransactionClient`, so the tx-denied members are omitted instead.
 */
type ChunkTxClient = Omit<ExtendedPrismaClient, ITXClientDenyList>;

/** Signed main image for one asset, uploaded before the transaction starts. */
export type ImportedImage = { mainImage: string; mainImageExpiration: Date };

/** Arguments for {@link writeImportChunk}. */
export type WriteImportChunkArgs = {
  importId: string;
  organizationId: string;
  /** The user who started the import: creator of the assets and QR codes. */
  userId: string;
  /** This chunk's slice of the stored rows. */
  rows: StoredImportRow[];
  /** Index of the chunk's first row in the whole import. */
  chunkStart: number;
  resolved: ResolvedImportEntities;
  canUseBarcodes: boolean;
  /** Signed images by asset id. Rows without an entry get no image. */
  imagePaths: Record<string, ImportedImage>;
  /**
   * Warnings found before the transaction (images that could not be
   * imported). Stored with the chunk's own warnings in the same transaction,
   * so they are kept only when the chunk commits.
   */
  extraWarnings?: ImportWarning[];
};

/** Outcome of {@link writeImportChunk}. */
export type WriteImportChunkResult = {
  /** False when the chunk had already been committed; nothing was written. */
  applied: boolean;
  /** `processedRows` once this chunk counts as done. */
  nextProcessedRows: number;
  /** Warnings stored for this chunk. Empty when `applied` is false. */
  warnings: ImportWarning[];
};

/** One row with its references resolved to ids and its columns typed. */
type PreparedRow = {
  row: StoredImportRow;
  categoryId: string | null;
  locationId: string | undefined;
  kitId: string | undefined;
  custodianId: string | undefined;
  assetModelId: string | undefined;
  tagIds: string[];
  type: AssetType | undefined;
  quantity: number | undefined;
  minQuantity: number | undefined;
  unitOfMeasure: string | undefined;
  consumptionType: Prisma.AssetCreateManyInput["consumptionType"];
};

/** One barcode cell value, typed and normalised. */
type RowBarcode = {
  row: StoredImportRow;
  type: BarcodeType;
  value: string;
};

/**
 * Builds a warning for a row.
 *
 * @param row - The stored row the warning is about
 * @param message - What was left out and why
 */
function warningFor(row: StoredImportRow, message: string): ImportWarning {
  return { row: row.rowNumber, title: row.title, message };
}

/**
 * Units a placement or kit pivot holds: the full pool for a
 * QUANTITY_TRACKED asset, otherwise 1. Same rule as `createAsset`'s
 * placement and `buildAssetKitCreateData`.
 */
function poolQuantity(prepared: PreparedRow): number {
  return prepared.type === AssetType.QUANTITY_TRACKED && prepared.quantity
    ? prepared.quantity
    : 1;
}

/**
 * Resolves a row's names to the ids the PREPARE step stored and types its
 * quantity-tracked columns.
 *
 * @param row - The stored row
 * @param resolved - Name to id maps from PREPARE
 * @returns The row with ids and typed columns
 * @throws {ShelfError} When a kit, custodian or asset model has no id. PREPARE
 * creates every one, so this marks a broken import, not a user error.
 */
function prepareRow(
  row: StoredImportRow,
  resolved: ResolvedImportEntities
): PreparedRow {
  // Kits and custodians are keyed by the trimmed cell; categories, locations
  // and models by the raw cell (see ResolvedImportEntities).
  const kitKey = row.kit?.trim();
  const kitId = kitKey ? resolved.kits[kitKey] : undefined;
  const custodianKey = row.custodian?.trim();
  const custodianId = custodianKey
    ? resolved.teamMembers[custodianKey]
    : undefined;
  const model = resolveImportedAssetModel({
    cell: row.assetModel,
    models: resolved.assetModels,
  });

  const unresolved =
    (kitKey && !kitId && `Kit "${kitKey}"`) ||
    (custodianKey && !custodianId && `Custodian "${custodianKey}"`) ||
    (model.name && !model.id && `Asset model "${model.name}"`);
  if (unresolved) {
    throw new ShelfError({
      cause: null,
      message: `${unresolved} could not be resolved for asset "${row.title}".`,
      additionalData: { assetId: row.assetId, rowNumber: row.rowNumber },
      label,
    });
  }

  // Validated at preview and again at confirm, so this cannot throw here.
  const qty = validateQtyTrackedFields(
    {
      type: row.type,
      quantity: row.quantity,
      minQuantity: row.minQuantity,
      unitOfMeasure: row.unitOfMeasure,
      consumptionType: row.consumptionType,
    },
    { kind: "create" },
    {
      rowLabel: `asset "${row.title}"`,
      additionalData: { assetKey: row.key },
    }
  );

  return {
    row,
    categoryId: (row.category && resolved.categories[row.category]) || null,
    locationId: (row.location && resolved.locations[row.location]) || undefined,
    kitId,
    custodianId,
    assetModelId: model.id,
    tagIds: (row.tags ?? [])
      .filter((tag) => resolved.tags[tag])
      .map((tag) => resolved.tags[tag]),
    ...qty,
  };
}

/**
 * The asset row `createAsset` would insert, as unchecked scalars.
 *
 * @param prepared - The resolved row
 * @param ctx - Sequential id, owner, workspace and signed image
 */
function toAssetCreateManyInput(
  prepared: PreparedRow,
  ctx: {
    sequentialId: string;
    userId: string;
    organizationId: string;
    image: ImportedImage | undefined;
  }
): Prisma.AssetCreateManyInput {
  const { row } = prepared;
  return {
    id: row.assetId,
    title: row.title,
    description: row.description || "",
    sequentialId: ctx.sequentialId,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    categoryId: prepared.categoryId,
    assetModelId: prepared.assetModelId ?? null,
    valuation: row.valuation ? +row.valuation : null,
    availableToBook: row.bookable !== "no",
    mainImage: ctx.image?.mainImage ?? null,
    mainImageExpiration: ctx.image?.mainImageExpiration ?? null,
    type: prepared.type,
    quantity: prepared.quantity,
    minQuantity: prepared.minQuantity,
    consumptionType: prepared.consumptionType,
    unitOfMeasure: prepared.unitOfMeasure,
    // Kit rows get their custody from the kit in FINALIZE, so only a row with
    // a custodian and no kit is in custody from the start.
    ...(prepared.custodianId && !prepared.kitId
      ? { status: AssetStatus.IN_CUSTODY }
      : {}),
  };
}

/**
 * Direct custody for a row with a custodian and no kit. A quantity-tracked
 * asset placed at a location takes its units from there.
 */
function toCustodyCreateManyInput(
  prepared: PreparedRow
): Prisma.CustodyCreateManyInput {
  return {
    assetId: prepared.row.assetId,
    teamMemberId: prepared.custodianId!,
    ...(prepared.type === AssetType.QUANTITY_TRACKED && prepared.locationId
      ? { locationId: prepared.locationId }
      : {}),
  };
}

/**
 * Builds the custom field values of every row. A value whose field was
 * deleted or retyped since the preview is skipped with a warning.
 *
 * @param prepared - The chunk's rows
 * @param fieldIdsByName - Custom field id by name, from PREPARE
 * @param definitions - The fields that still exist, by id
 * @param warnings - Collector for skipped values
 * @returns Rows for `assetCustomFieldValue.createMany`
 */
function buildCustomFieldValueRows(
  prepared: PreparedRow[],
  fieldIdsByName: Record<string, string>,
  definitions: Map<string, Pick<CustomField, "id" | "name" | "type">>,
  warnings: ImportWarning[]
): Prisma.AssetCustomFieldValueCreateManyInput[] {
  const values: Prisma.AssetCustomFieldValueCreateManyInput[] = [];

  for (const { row } of prepared) {
    for (const [key, raw] of Object.entries(row)) {
      if (!key.startsWith("cf:")) continue;
      if (
        raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim() === "")
      ) {
        continue;
      }

      const { name } = getDefinitionFromCsvHeader(key);
      const fieldId = fieldIdsByName[name];
      // A column PREPARE did not resolve is not imported, same as the
      // synchronous importer.
      if (!fieldId) continue;

      const definition = definitions.get(fieldId);
      if (!definition) {
        warnings.push(
          warningFor(
            row,
            `Custom field "${name}" no longer exists; the value was not imported.`
          )
        );
        continue;
      }

      let value: ShelfAssetCustomFieldValueType["value"] | undefined;
      try {
        value = buildCustomFieldValue({ raw }, definition);
      } catch {
        // The preview proved the value fits, so the field changed since.
        warnings.push(
          warningFor(
            row,
            `Custom field "${name}" changed during the import; the value "${String(
              raw
            )}" was not imported.`
          )
        );
        continue;
      }

      if (value) {
        values.push({
          assetId: row.assetId,
          customFieldId: definition.id,
          // `ICustomFieldValueJson` is an interface (no index signature) and
          // types `valueMultiLineText` as a Markdoc node, so it is not
          // assignable to Prisma's JSON input although the built value is
          // plain JSON. Same double cast as the stored rows in preview.server.ts.
          value: value as unknown as Prisma.InputJsonValue,
        });
      }
    }
  }

  return values;
}

/**
 * Reads every barcode cell of the chunk, split and normalised the way the
 * preview validated them.
 *
 * @param rows - The chunk's rows
 */
function collectRowBarcodes(rows: StoredImportRow[]): RowBarcode[] {
  const barcodes: RowBarcode[] = [];
  for (const row of rows) {
    for (const { column, type } of BARCODE_IMPORT_COLUMNS) {
      const cell = row[column];
      if (typeof cell !== "string" || !cell.trim()) continue;
      for (const value of decodeCsvListCell(cell)) {
        barcodes.push({ row, type, value: normalizeBarcodeValue(type, value) });
      }
    }
  }
  return barcodes;
}

/**
 * Message for a barcode that another item holds by the time the chunk runs.
 *
 * @param value - The normalised barcode value
 */
function barcodeTakenMessage(value: string): string {
  return `Barcode "${value}" was added to another item during the import and was skipped.`;
}

/**
 * Attaches the chunk's barcodes: reuses orphaned rows, creates the rest, and
 * turns any value another item holds into a warning.
 *
 * @param tx - The chunk's transaction
 * @param barcodes - The chunk's barcode values
 * @param organizationId - Workspace the barcodes belong to
 * @param warnings - Collector for skipped values
 */
async function writeBarcodes(
  tx: ChunkTxClient,
  barcodes: RowBarcode[],
  organizationId: string,
  warnings: ImportWarning[]
): Promise<void> {
  if (barcodes.length === 0) return;

  const existing = await tx.barcode.findMany({
    where: { organizationId, value: { in: barcodes.map((b) => b.value) } },
    select: { id: true, value: true, assetId: true, kitId: true },
  });
  const existingByValue = new Map(existing.map((b) => [b.value, b]));

  const toCreate: RowBarcode[] = [];
  for (const barcode of barcodes) {
    const found = existingByValue.get(barcode.value);
    if (!found) {
      toCreate.push(barcode);
      continue;
    }
    if (found.assetId || found.kitId) {
      warnings.push(
        warningFor(barcode.row, barcodeTakenMessage(barcode.value))
      );
      continue;
    }
    // An orphaned row with this value is reused and retyped to the column it
    // came from, as `createAsset` does. Guarded on still being an orphan.
    const { count } = await tx.barcode.updateMany({
      where: { id: found.id, organizationId, assetId: null, kitId: null },
      data: { assetId: barcode.row.assetId, type: barcode.type },
    });
    if (count === 0) {
      warnings.push(
        warningFor(barcode.row, barcodeTakenMessage(barcode.value))
      );
    }
  }

  if (toCreate.length === 0) return;

  await tx.barcode.createMany({
    data: toCreate.map(({ row, type, value }) => ({
      type,
      value,
      organizationId,
      assetId: row.assetId,
    })),
    skipDuplicates: true,
  });

  // A value created by someone else between the read and the insert is
  // skipped by `skipDuplicates`; find those by reading back what landed.
  const landed = await tx.barcode.findMany({
    where: {
      organizationId,
      assetId: { in: [...new Set(toCreate.map((b) => b.row.assetId))] },
    },
    select: { value: true, assetId: true },
  });
  const landedKeys = new Set(landed.map((b) => `${b.assetId}\u0000${b.value}`));
  for (const barcode of toCreate) {
    if (!landedKeys.has(`${barcode.row.assetId}\u0000${barcode.value}`)) {
      warnings.push(
        warningFor(barcode.row, barcodeTakenMessage(barcode.value))
      );
    }
  }
}

/**
 * Distinct, defined ids.
 *
 * @param ids - Ids, possibly with gaps and repeats
 */
function distinct(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((v): v is string => Boolean(v)))];
}

/**
 * Appends warnings to an import, keeping at most MAX_STORED_IMPORT_WARNINGS in
 * the JSON array while `warningCount` always counts every warning. One
 * statement, so concurrent appends cannot lose each other's warnings. The
 * array can overshoot the cap by at most one call's warnings.
 *
 * @param tx - Transaction or client to run on
 * @param importId - The import to append to
 * @param warnings - Warnings to store; nothing is written when empty
 */
export async function appendImportWarnings(
  tx: Pick<ExtendedPrismaClient, "$executeRaw">,
  importId: string,
  warnings: ImportWarning[]
): Promise<void> {
  if (warnings.length === 0) return;
  await tx.$executeRaw`
    UPDATE "AssetImport"
    SET "warnings" = CASE
          WHEN jsonb_array_length(COALESCE("warnings", '[]'::jsonb)) >= ${MAX_STORED_IMPORT_WARNINGS}
            THEN "warnings"
          ELSE COALESCE("warnings", '[]'::jsonb) || ${JSON.stringify(
            warnings
          )}::jsonb
        END,
        "warningCount" = "warningCount" + ${warnings.length}
    WHERE "id" = ${importId}`;
}

/**
 * Writes one chunk of an import in a single transaction.
 *
 * Statements, in order: the progress guard, the org guards, the custom field
 * definitions, the sequential ids, then one batch per table (assets, QR codes,
 * tags, placements, kit pivots, custody, custom field values, barcodes), the
 * warnings and the `ASSET_CREATED` events.
 *
 * @param args - See {@link WriteImportChunkArgs}
 * @returns Whether the chunk was written, the new `processedRows` and the
 * warnings stored for it
 * @throws {ShelfError} When any statement fails; the transaction rolls back
 * and nothing of the chunk is kept (sequence values consumed stay used)
 */
export async function writeImportChunk({
  importId,
  organizationId,
  userId,
  rows,
  chunkStart,
  resolved,
  canUseBarcodes,
  imagePaths,
  extraWarnings = [],
}: WriteImportChunkArgs): Promise<WriteImportChunkResult> {
  const nextProcessedRows = chunkStart + rows.length;

  try {
    return await db.$transaction(
      async (tx): Promise<WriteImportChunkResult> => {
        // Progress guard. Holds the import row's lock for the rest of the
        // transaction, so a concurrent duplicate waits and then matches 0.
        const { count: claimed } = await tx.assetImport.updateMany({
          where: { id: importId, organizationId, processedRows: chunkStart },
          data: { processedRows: nextProcessedRows },
        });
        if (claimed === 0) {
          return { applied: false, nextProcessedRows, warnings: [] };
        }

        const warnings: ImportWarning[] = [...extraWarnings];
        const prepared = rows.map((row) => prepareRow(row, resolved));
        const withLocation = prepared.filter((p) => p.locationId);
        const withKit = prepared.filter((p) => p.kitId);
        const withCustody = prepared.filter((p) => p.custodianId && !p.kitId);

        // The ids come from PREPARE, but every id written still has to be
        // proven to belong to this workspace.
        await assertCategoriesBelongToOrg(
          {
            categoryIds: distinct(prepared.map((p) => p.categoryId)),
            organizationId,
          },
          tx
        );
        await assertLocationsBelongToOrg(
          {
            locationIds: distinct(withLocation.map((p) => p.locationId)),
            organizationId,
          },
          tx
        );
        await assertTagsBelongToOrg(
          {
            tagIds: distinct(prepared.flatMap((p) => p.tagIds)),
            organizationId,
          },
          tx
        );
        await assertKitsBelongToOrg(
          { kitIds: distinct(withKit.map((p) => p.kitId)), organizationId },
          tx
        );
        await assertTeamMembersBelongToOrg(
          {
            teamMemberIds: distinct(withCustody.map((p) => p.custodianId)),
            organizationId,
          },
          tx
        );
        await assertAssetModelsBelongToOrg(
          {
            assetModelIds: distinct(prepared.map((p) => p.assetModelId)),
            organizationId,
          },
          tx
        );

        // The org-scoped read is the custom field guard: a field missing here
        // was deleted since PREPARE and turns into a warning, not a failure.
        const fieldIds = distinct(Object.values(resolved.customFields));
        const definitions =
          fieldIds.length > 0
            ? await tx.customField.findMany({
                where: {
                  id: { in: fieldIds },
                  organizationId,
                  deletedAt: null,
                },
                select: { id: true, name: true, type: true },
              })
            : [];
        const customFieldValues = buildCustomFieldValueRows(
          prepared,
          resolved.customFields,
          new Map(definitions.map((d) => [d.id, d])),
          warnings
        );

        const sequentialIds = await getNextSequentialIds(
          organizationId,
          rows.length,
          tx
        );

        await tx.asset.createMany({
          data: prepared.map((p, index) =>
            toAssetCreateManyInput(p, {
              sequentialId: sequentialIds[index],
              userId,
              organizationId,
              image: imagePaths[p.row.assetId],
            })
          ),
        });

        // QR codes: a code claimed at preview is linked if it is still free;
        // every other row gets a new code.
        const needsNewQr: StoredImportRow[] = [];
        for (const { row } of prepared) {
          const qrId = resolved.qrIdsByRowKey[row.key];
          if (!qrId) {
            needsNewQr.push(row);
            continue;
          }
          const { count } = await tx.qr.updateMany({
            where: { id: qrId, organizationId, assetId: null, kitId: null },
            data: { assetId: row.assetId },
          });
          if (count === 0) {
            needsNewQr.push(row);
            warnings.push(
              warningFor(
                row,
                `QR code "${qrId}" was linked to something else during the import. The asset got a new QR code.`
              )
            );
          }
        }
        if (needsNewQr.length > 0) {
          await tx.qr.createMany({
            data: needsNewQr.map((row) => ({
              id: id(),
              version: 0,
              errorCorrection: ErrorCorrection.L,
              userId,
              organizationId,
              assetId: row.assetId,
            })),
          });
        }

        // Implicit m2m join table: "A" is the asset id, "B" the tag id
        // (Prisma orders the columns by model name, Asset before Tag).
        const tagPairs = prepared.flatMap((p) =>
          p.tagIds.map((tagId) => [p.row.assetId, tagId] as const)
        );
        if (tagPairs.length > 0) {
          const tagAssetIds = tagPairs.map(([assetId]) => assetId);
          const tagIds = tagPairs.map(([, tagId]) => tagId);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "_AssetToTag" ("A", "B")
            SELECT * FROM unnest(${tagAssetIds}::text[], ${tagIds}::text[])
            ON CONFLICT DO NOTHING`);
        }

        if (withLocation.length > 0) {
          await tx.assetLocation.createMany({
            data: withLocation.map((p) => ({
              assetId: p.row.assetId,
              locationId: p.locationId!,
              organizationId,
              quantity: poolQuantity(p),
            })),
          });
        }

        if (withKit.length > 0) {
          await tx.assetKit.createMany({
            data: withKit.map((p) => ({
              assetId: p.row.assetId,
              kitId: p.kitId!,
              organizationId,
              quantity: poolQuantity(p),
            })),
          });
        }

        if (withCustody.length > 0) {
          await tx.custody.createMany({
            data: withCustody.map(toCustodyCreateManyInput),
          });
        }

        if (customFieldValues.length > 0) {
          await tx.assetCustomFieldValue.createMany({
            data: customFieldValues,
          });
        }

        if (canUseBarcodes) {
          await writeBarcodes(
            tx,
            collectRowBarcodes(rows),
            organizationId,
            warnings
          );
        }

        await appendImportWarnings(tx, importId, warnings);

        await recordEvents(
          rows.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "ASSET_CREATED" as const,
            entityType: "ASSET" as const,
            entityId: row.assetId,
            assetId: row.assetId,
          })),
          tx
        );

        return { applied: true, nextProcessedRows, warnings };
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
  } catch (cause) {
    const innerCause = isLikeShelfError(cause) ? cause.cause : cause;
    const rawMessage =
      innerCause instanceof Error ? innerCause.message : undefined;

    // Last line of defence: custom field values are checked above, so the
    // database's value-shape constraint should never fire.
    if (
      rawMessage &&
      rawMessage.includes("AssetCustomFieldValue") &&
      rawMessage.includes("ensure_value_structure_and_types")
    ) {
      throw new ShelfError({
        cause,
        label,
        message:
          "We were unable to save numeric custom field values. Please ensure AMOUNT and NUMBER fields use plain numbers without currency symbols or letters (e.g., 600.00).",
        additionalData: { importId, organizationId, chunkStart },
        shouldBeCaptured: false,
        status: 400,
      });
    }

    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while writing imported assets",
      additionalData: {
        importId,
        organizationId,
        chunkStart,
        rowCount: rows.length,
        ...(isLikeShelfError(cause) && cause.additionalData),
      },
      label,
    });
  }
}
