/**
 * Asset placements in the workspace backup.
 *
 * The backup export writes each asset's placements as JSON, by location name,
 * and the backup restore reads them back and recreates them. These helpers are
 * the pure half of that round trip: what goes into the `assetLocations` cell,
 * how the cell is read back, and which placements a restored asset gets. The
 * database half (resolving names to locations) lives in the restore itself.
 *
 * @see {@link file://./../../utils/csv.server.ts} `buildCsvBackupDataFromAssets`
 * @see {@link file://./../../utils/import.server.ts} `extractCSVDataFromBackupImport`
 * @see {@link file://./service.server.ts} `createAssetsFromBackupImport`
 */
import { AssetType } from "@prisma/client";
import { z } from "zod";
import { ShelfError } from "~/utils/error";

/**
 * One placement as the workspace backup carries it: the location's name and
 * how many units sit there. It is a name, never an id, because an id only
 * resolves in the workspace the backup came from.
 */
export type BackupPlacement = { location: string; quantity: number };

const backupPlacementsSchema = z.array(
  z.object({
    location: z.string().refine((name) => name.trim().length > 0),
    quantity: z.number().int().positive(),
  })
);

/**
 * The `assetLocations` cell of a backup exported before placements had their
 * own case: each row stringified to `[object Object]`. It holds no placement
 * data at all, so it reads as "no placements" and the rest of the row restores.
 */
const UNSERIALIZED_PLACEMENTS_CELL = /^\[object Object\](,\[object Object\])*$/;

/** The part of an `assetLocations` row (location included) the backup reads. */
type PlacementRow = {
  quantity: number;
  assetKitId?: string | null;
  location: { name: string };
};

function isPlacementRow(row: unknown): row is PlacementRow {
  if (typeof row !== "object" || row === null) return false;
  const { assetKitId, quantity, location } = row as Record<string, unknown>;
  return (
    (assetKitId === null ||
      assetKitId === undefined ||
      typeof assetKitId === "string") &&
    typeof quantity === "number" &&
    typeof location === "object" &&
    location !== null &&
    typeof (location as Record<string, unknown>).name === "string"
  );
}

/**
 * Writes an asset's placements for the backup export.
 *
 * - An individual asset sits at one location, so it writes that one, at 1.
 *   Its row there is normally manual, but a kit-driven one names the same
 *   place, and the backup carries no kits to rebuild it from.
 * - A pool writes its manual placements (`assetKitId` null) only. Its kit
 *   slices are a separate axis: the database caps manual placements at the
 *   pool's quantity without counting them, so written back as manual rows
 *   they could exceed it.
 *
 * @param rows - The asset's `assetLocations`, loaded with their `location`.
 * @param assetType - The asset's type. Anything but `QUANTITY_TRACKED` is
 *   treated as individual, the column's default.
 * @returns One entry per written placement, by location name.
 */
export function serializeBackupPlacements(
  rows: unknown,
  assetType: unknown
): BackupPlacement[] {
  if (!Array.isArray(rows)) return [];
  const placed = rows.filter(isPlacementRow);
  const manual = placed.filter((row) => !row.assetKitId);

  if (assetType !== AssetType.QUANTITY_TRACKED) {
    const row = manual[0] ?? placed[0];
    return row ? [{ location: row.location.name, quantity: 1 }] : [];
  }

  return manual.map((row) => ({
    location: row.location.name,
    quantity: row.quantity,
  }));
}

/**
 * Reads an `assetLocations` cell of a backup file back into placements.
 *
 * @param cell - The raw cell, JSON as {@link serializeBackupPlacements} writes it.
 * @param rowNumber - The row's number in the file, for the error message.
 * @returns The placements. None for a cell written before placements were
 *   exported (see {@link UNSERIALIZED_PLACEMENTS_CELL}).
 * @throws {ShelfError} 400 when the cell is any other shape. Restoring the
 *   asset without its placements would lose them silently.
 */
export function parseBackupPlacements(
  cell: string,
  rowNumber: number
): BackupPlacement[] {
  if (UNSERIALIZED_PLACEMENTS_CELL.test(cell.trim())) return [];

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

/** What a backup's legacy `location` object says about the location. */
export type BackupLocationDetails = {
  description?: string;
  address?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * Reads the `location` object of a backup written before placements existed.
 *
 * @param location - The parsed `location` cell, if the row has one.
 * @returns The location's name and the details a restore creates it with when
 *   the workspace has no location of that name. `null` when there is none.
 */
export function readLegacyBackupLocation(
  location: unknown
): { name: string; details: BackupLocationDetails } | null {
  if (typeof location !== "object" || location === null) return null;
  const { name, description, address, createdAt, updatedAt } =
    location as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") return null;

  const text = (value: unknown) =>
    typeof value === "string" && value !== "" ? value : undefined;
  const date = (value: unknown) => {
    if (typeof value !== "string" || value === "") return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  return {
    name,
    details: {
      description: text(description),
      address: text(address),
      createdAt: date(createdAt),
      updatedAt: date(updatedAt),
    },
  };
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

  const legacy = readLegacyBackupLocation(location);
  if (!legacy) return [];

  const total = Number(quantity);
  return [
    {
      location: legacy.name,
      quantity: isPool && Number.isInteger(total) && total > 0 ? total : 1,
    },
  ];
}
