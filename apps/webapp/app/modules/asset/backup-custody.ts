/**
 * Asset custody in the workspace backup restore.
 *
 * The backup export writes an asset's custody rows whole, each with its
 * `custodian` team member. Every id in them belongs to the workspace the
 * backup came from, so a restore reads only the custodian's name and the
 * quantity held, and resolves the name in the target workspace. This is the
 * pure half: which custody a restored asset gets. The database half (finding
 * or creating the team member) lives in the restore itself.
 *
 * @see {@link file://./service.server.ts} `createAssetsFromBackupImport`
 * @see {@link file://./backup-placements.ts} the same split for placements
 */
import { AssetType } from "@prisma/client";

/** One custody a restored asset is created with. */
export type BackupCustody = {
  /** The custodian team member's name, as the source workspace spelled it. */
  custodianName: string;
  /** Timestamps to create the team member with when the workspace has none
   * of that name. */
  createdAt?: Date;
  updatedAt?: Date;
  /** Units held. Always 1 for an individual asset. */
  quantity: number;
};

/** Reads a date the backup wrote as an ISO string, if it is one. */
function readDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The custody a restored asset gets from its backup row.
 *
 * - The cell holds a list of custody rows. A backup written while custody was
 *   one row per asset holds a single object instead; it reads as a list of one.
 * - A pool keeps every custodian, with the units each holds. Rows naming the
 *   same custodian are added up: kit-driven custody comes back as the
 *   custodian's own, because the backup carries no kits to rebuild it from.
 * - An individual asset is held by one custodian, so it keeps the first, at 1.
 *
 * @param args.type - The row's asset type. Missing means individual, the
 *   column's default.
 * @param args.custody - The parsed `custody` cell, if the row has one.
 * @returns One entry per custodian, in the order the file lists them.
 */
export function custodiesForRestore({
  type,
  custody,
}: {
  type: unknown;
  custody: unknown;
}): BackupCustody[] {
  const rows: unknown[] = Array.isArray(custody) ? custody : [custody];

  const byName = new Map<string, BackupCustody>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { custodian, quantity } = row as Record<string, unknown>;
    if (typeof custodian !== "object" || custodian === null) continue;
    const { name, createdAt, updatedAt } = custodian as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "") continue;

    const units =
      typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
        ? quantity
        : 1;
    const seen = byName.get(name);
    if (seen) {
      seen.quantity += units;
    } else {
      byName.set(name, {
        custodianName: name,
        createdAt: readDate(createdAt),
        updatedAt: readDate(updatedAt),
        quantity: units,
      });
    }
  }

  const custodies = [...byName.values()];
  if (type === AssetType.QUANTITY_TRACKED) return custodies;
  return custodies.length > 0 ? [{ ...custodies[0], quantity: 1 }] : [];
}
