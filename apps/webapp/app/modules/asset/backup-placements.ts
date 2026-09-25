import { AssetType } from "@prisma/client";
import { z } from "zod";
import { ShelfError } from "~/utils/error";

/**
 * One manual placement as the workspace backup carries it: the location's
 * name and how many units sit there. It is a name, never an id, because an id
 * only resolves in the workspace the backup came from.
 */
export type BackupPlacement = { location: string; quantity: number };

const backupPlacementsSchema = z.array(
  z.object({
    location: z.string().refine((name) => name.trim().length > 0),
    quantity: z.number().int().positive(),
  })
);

/** The part of an `assetLocations` row (location included) the backup reads. */
type ManualPlacementRow = { quantity: number; location: { name: string } };

/**
 * A manual placement is one with no `assetKitId`. A kit-driven row is not the
 * asset's own placement: it mirrors the kit's location and is recreated when
 * the asset joins a kit, so writing it out would place those units twice.
 */
function isManualPlacementRow(row: unknown): row is ManualPlacementRow {
  if (typeof row !== "object" || row === null) return false;
  const { assetKitId, quantity, location } = row as Record<string, unknown>;
  return (
    (assetKitId === null || assetKitId === undefined) &&
    typeof quantity === "number" &&
    typeof location === "object" &&
    location !== null &&
    typeof (location as Record<string, unknown>).name === "string"
  );
}

/**
 * Writes an asset's placements for the backup export.
 *
 * @param rows - The asset's `assetLocations`, loaded with their `location`.
 * @returns One entry per manual placement, by location name. An individual
 *   asset has at most one, with a quantity of 1.
 */
export function serializeBackupPlacements(rows: unknown): BackupPlacement[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isManualPlacementRow).map((row) => ({
    location: row.location.name,
    quantity: row.quantity,
  }));
}

/**
 * Reads an `assetLocations` cell of a backup file back into placements.
 *
 * @param cell - The raw cell, JSON as {@link serializeBackupPlacements} writes it.
 * @param rowNumber - The row's line in the file, for the error message.
 * @throws {ShelfError} 400 when the cell is not that shape. Restoring the
 *   asset without its placements would lose them silently.
 */
export function parseBackupPlacements(
  cell: string,
  rowNumber: number
): BackupPlacement[] {
  const invalid = (cause: unknown) =>
    new ShelfError({
      cause,
      title: "Invalid backup file",
      message: `Row ${rowNumber} has an assetLocations value the backup export does not write. Each entry needs a location name and a whole quantity above zero.`,
      additionalData: { rowNumber, cell },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });

  let json: unknown;
  try {
    json = JSON.parse(cell);
  } catch (cause) {
    throw invalid(cause);
  }

  const result = backupPlacementsSchema.safeParse(json);
  if (!result.success) throw invalid(result.error);
  return result.data;
}

/**
 * The placements a restored asset gets from its backup row.
 *
 * - A pool keeps every placement as written.
 * - An individual asset sits at one location with one unit, so it keeps the
 *   first entry, at 1.
 * - A backup written before placements existed has no `assetLocations`, only
 *   a `location` object. It restores the way that column was migrated: a
 *   pool's whole quantity at that location, anything else 1 unit.
 *
 * @param args.type - The row's asset type. Missing means individual, the
 *   column's default.
 * @param args.quantity - The row's total quantity, as a string or number.
 * @param args.assetLocations - Placements parsed by {@link parseBackupPlacements}.
 * @param args.location - The legacy `location` object, if the file has one.
 */
export function placementsForRestore({
  type,
  quantity,
  assetLocations,
  location,
}: {
  type: unknown;
  quantity: unknown;
  assetLocations?: BackupPlacement[];
  location?: unknown;
}): BackupPlacement[] {
  const isPool = type === AssetType.QUANTITY_TRACKED;

  if (assetLocations && assetLocations.length > 0) {
    return isPool
      ? assetLocations
      : [{ location: assetLocations[0].location, quantity: 1 }];
  }

  const legacyName =
    typeof location === "object" && location !== null
      ? (location as Record<string, unknown>).name
      : undefined;
  if (typeof legacyName !== "string" || legacyName.trim() === "") return [];

  const total = Number(quantity);
  return [
    {
      location: legacyName,
      quantity: isPool && Number.isInteger(total) && total > 0 ? total : 1,
    },
  ];
}
