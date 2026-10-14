/**
 * Asset import lease
 *
 * One step of an import runs at a time. A step claims the import by setting
 * `AssetImport.lockedUntil` a lease length into the future; another run of any
 * step can only claim it once that time has passed or the lease was released.
 * Every claim and renewal also bumps `updatedAt`, which is what stall detection
 * reads.
 *
 * Only QUEUED and RUNNING imports can be claimed: a DRAFT was never confirmed,
 * and a COMPLETED or FAILED import has nothing left to run.
 *
 * @see {@link file://./worker.server.ts} the job runner that holds the lease
 * @see {@link file://./constants.ts} `ASSET_IMPORT_LEASE_MINUTES`
 */
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { ASSET_IMPORT_LEASE_MINUTES } from "./constants";

/** Identifies the import a lease is about. */
export type ImportLeaseArgs = {
  importId: string;
  /** Workspace that owns the import; every lease write is scoped by it. */
  organizationId: string;
};

/** When a lease taken now runs out. */
function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + ASSET_IMPORT_LEASE_MINUTES * 60 * 1000);
}

/**
 * Claims the import for the calling step.
 *
 * @param args - The import to claim
 * @returns True when this call took the lease, false when another run holds
 * an unexpired lease or the import is not QUEUED or RUNNING
 */
export async function claimImportLease({
  importId,
  organizationId,
}: ImportLeaseArgs): Promise<boolean> {
  const now = new Date();
  const { count } = await db.assetImport.updateMany({
    where: {
      id: importId,
      organizationId,
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: leaseExpiry(now) },
  });
  return count === 1;
}

/**
 * Extends the lease the calling step holds. Long steps call it as they go so
 * the lease never lapses mid-step and `updatedAt` keeps moving.
 *
 * @param args - The import whose lease to extend
 */
export async function renewImportLease({
  importId,
  organizationId,
}: ImportLeaseArgs): Promise<void> {
  await db.assetImport.updateMany({
    where: {
      id: importId,
      organizationId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: { lockedUntil: leaseExpiry(new Date()) },
  });
}

/**
 * Releases the lease so the next step can claim the import straight away.
 * Never throws: a lease that cannot be released simply lapses after
 * `ASSET_IMPORT_LEASE_MINUTES`.
 *
 * @param args - The import whose lease to release
 */
export async function releaseImportLease({
  importId,
  organizationId,
}: ImportLeaseArgs): Promise<void> {
  try {
    await db.assetImport.updateMany({
      where: { id: importId, organizationId },
      data: { lockedUntil: null },
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to release the asset import lease",
        additionalData: { importId, organizationId },
        label: "Asset Import",
      })
    );
  }
}
