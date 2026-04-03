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
 * @param tx - Prisma interactive transaction client
 * @param assetId - The ID of the asset to lock
 * @returns The full Asset row (with the lock held)
 * @throws {ShelfError} If the asset is not found (404)
 */
export async function lockAssetForQuantityUpdate(
  tx: any, // Prisma interactive transaction client
  assetId: string
): Promise<Asset> {
  const result = await tx.$queryRaw<Asset[]>`
    SELECT * FROM "Asset" WHERE id = ${assetId} FOR UPDATE
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
