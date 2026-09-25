/**
 * Custody in the workspace backup.
 *
 * The backup export writes each asset's `custody` cell as its Custody rows,
 * whole, custodian included. The restore cannot use their ids (they only
 * resolve in the workspace the backup came from), so it recreates custody by
 * custodian name. This module is the pure half of that: which custody a
 * restored asset gets from its row. Resolving names to team members lives in
 * the restore itself.
 *
 * @see {@link file://./../../utils/csv.server.ts} `buildCsvBackupDataFromAssets`
 * @see {@link file://./service.server.ts} `createAssetsFromBackupImport`
 */
import { AssetType } from "@prisma/client";

/** What the backup says about a custodian, to find or create them by. */
export type BackupCustodian = {
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
};

/** One custody allocation a restored asset gets: who holds how many units. */
export type BackupCustody = { custodian: BackupCustodian; quantity: number };

/** A Custody row as the backup carries it, reduced to what the restore reads. */
type BackupCustodyRow = {
  custodian: BackupCustodian;
  quantity: unknown;
  kitCustodyId: unknown;
};

function readDate(value: unknown) {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function readCustodyRow(row: unknown): BackupCustodyRow | null {
  if (typeof row !== "object" || row === null) return null;
  const { custodian, quantity, kitCustodyId } = row as Record<string, unknown>;
  if (typeof custodian !== "object" || custodian === null) return null;

  const { name, createdAt, updatedAt } = custodian as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") return null;

  return {
    custodian: {
      name,
      createdAt: readDate(createdAt),
      updatedAt: readDate(updatedAt),
    },
    quantity,
    kitCustodyId,
  };
}

/**
 * The custody a restored asset gets from its backup row.
 *
 * - Only operator custody is restored. A row with a `kitCustodyId` exists
 *   because the asset's kit is in custody; the backup carries no kits, so the
 *   asset comes back outside any kit and without that custody.
 * - An individual asset has at most one custodian, so it keeps the first
 *   operator row, at 1 unit.
 * - A pool keeps every operator row with its quantity. A row without a whole
 *   quantity above zero gets 1, the column's default.
 * - A backup written while an asset had at most one custody row carries that
 *   row as a single object rather than a list. It restores as that one row.
 *
 * @param args.type - The row's asset type. Missing means individual, the
 *   column's default.
 * @param args.custody - The parsed `custody` cell, if the row has one.
 * @returns One entry per custody row to create. Two entries may name the same
 *   custodian; the restore adds their units up.
 */
export function custodyForRestore({
  type,
  custody,
}: {
  type: unknown;
  custody: unknown;
}): BackupCustody[] {
  const rows = (Array.isArray(custody) ? custody : [custody])
    .map(readCustodyRow)
    .filter((row): row is BackupCustodyRow => row !== null)
    // The export turns a null `kitCustodyId` into "".
    .filter(({ kitCustodyId }) => !kitCustodyId);

  if (type !== AssetType.QUANTITY_TRACKED) {
    return rows.length > 0
      ? [{ custodian: rows[0].custodian, quantity: 1 }]
      : [];
  }

  return rows.map(({ custodian, quantity }) => ({
    custodian,
    quantity:
      typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
        ? quantity
        : 1,
  }));
}
