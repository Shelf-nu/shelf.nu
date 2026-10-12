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
import { Prisma } from "@prisma/client";
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

/**
 * Row-locks several assets in one statement, in id order.
 *
 * The order is the one every multi-asset locker uses (the booking check-out
 * and check-in paths lock asset by asset in sorted id order), so two
 * transactions touching the same assets can never deadlock. `FOR UPDATE`
 * locks rows as the sorted result is produced. Org-scoped like
 * {@link lockAssetForQuantityUpdate}: foreign ids match nothing and are not
 * locked. Missing ids are simply absent from the result.
 *
 * @param tx - Prisma interactive transaction client
 * @param assetIds - Assets to lock; duplicates are ignored
 * @param organizationId - The caller's organization
 * @returns The locked rows' id, type and quantity
 */
export function lockAssetsForQuantityUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, // Prisma interactive tx client (no clean type for extended clients)
  assetIds: string[],
  organizationId: string
): Promise<Array<Pick<Asset, "id" | "type" | "quantity">>> {
  const ids = Array.from(new Set(assetIds)).sort();
  if (ids.length === 0) return Promise.resolve([]);

  return tx.$queryRaw`
    SELECT id, type, quantity FROM "Asset"
    WHERE id IN (${Prisma.join(ids)}) AND "organizationId" = ${organizationId}
    ORDER BY id
    FOR UPDATE
  `;
}
