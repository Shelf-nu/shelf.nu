/**
 * Quantity Lock Helper
 *
 * Provides row-level locking for safe concurrent quantity updates on assets.
 * Uses PostgreSQL `SELECT ... FOR UPDATE` to serialize access within an
 * interactive Prisma transaction, preventing race conditions when multiple
 * requests modify the same asset's quantity simultaneously.
 *
 * @see {@link file://./../consumption-log/service.server.ts} — Consumer of this lock
 */

import type { Asset } from "@prisma/client";
import { ShelfError } from "~/utils/error";

/**
 * Acquires a row-level lock on an asset for safe quantity updates.
 *
 * Must be called within a `db.$transaction()` interactive transaction.
 * Uses PostgreSQL `SELECT FOR UPDATE` to prevent concurrent modifications
 * to the same asset's quantity fields until the transaction completes.
 *
 * The lock is **org-scoped**: the `FOR UPDATE` predicate filters on both
 * `id` AND `organizationId`, so a caller passing a FOREIGN-org asset id
 * never acquires a lock on another org's row. Without this, an attacker in
 * Org A could pass Org B's asset id and take a real `FOR UPDATE` lock on
 * Org B's row before any downstream org check rejects it — a cross-tenant
 * lock oracle / contention vector (IDOR). A foreign-org (or missing) id now
 * matches zero rows and 404s here, taking no lock and leaking no existence.
 *
 * @param tx - Prisma interactive transaction client
 * @param assetId - The ID of the asset to lock
 * @param organizationId - The caller's authenticated organization id; the
 *   lock is scoped to it so foreign-org ids can never acquire the lock
 * @returns The full Asset row (with the lock held)
 * @throws {ShelfError} If the asset is not found in the caller's org (404)
 */
export async function lockAssetForQuantityUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, // Prisma interactive tx client (no clean type for extended clients)
  assetId: string,
  organizationId: string
): Promise<Asset> {
  const result = await tx.$queryRaw<Asset[]>`
    SELECT * FROM "Asset" WHERE id = ${assetId} AND "organizationId" = ${organizationId} FOR UPDATE
  `;

  if (!result || result.length === 0) {
    throw new ShelfError({
      cause: null,
      message: "Asset not found",
      label: "Consumption Log",
      status: 404,
    });
  }

  return result[0];
}
