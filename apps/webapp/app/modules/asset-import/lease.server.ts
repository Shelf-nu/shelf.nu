/**
 * Asset import lease
 *
 * One step of an import runs at a time. A step claims the import by setting
 * `AssetImport.lockedUntil` a lease length into the future; another run of any
 * step can only claim it once that time has passed or the lease was released.
 * Every claim also bumps `updatedAt`, which is what stall detection reads.
 *
 * A lease is never renewed, and it always ends before the job that took it
 * expires (see `ASSET_IMPORT_LEASE_MINUTES`). When a process dies mid-step,
 * pg-boss retries the job only after its expiry, so the retry always finds the
 * dead run's lease lapsed and can carry on the chain.
 *
 * A step hands off by releasing the lease, then queuing the next step. When
 * the release fails, the next step is queued with a delay of
 * `ASSET_IMPORT_UNRELEASED_LEASE_DELAY_SECONDS`, so its claim runs after the
 * unreleased lease has lapsed instead of finding it held.
 *
 * Only QUEUED and RUNNING imports can be claimed: a DRAFT was never confirmed,
 * and a COMPLETED or FAILED import has nothing left to run.
 *
 * @see {@link file://./worker.server.ts} the job runner that holds the lease
 * @see {@link file://./constants.ts} `ASSET_IMPORT_LEASE_MINUTES`,
 * `ASSET_IMPORT_UNRELEASED_LEASE_DELAY_SECONDS`
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

/**
 * When a lease taken at `now` runs out: one minute before the job that took
 * it expires, so the lease always lapses before pg-boss retries that job.
 *
 * @param now - When the lease is claimed
 * @returns The end of the lease
 */
function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + (ASSET_IMPORT_LEASE_MINUTES - 1) * 60 * 1000);
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
 * Releases the lease so the next step can claim the import straight away.
 * Never throws: a failure is logged and reported through the result. A lease
 * that was not released stays held until it lapses, so a caller handing off
 * to the next step must delay that step (see the job runner's hand-off).
 *
 * @param args - The import whose lease to release
 * @returns True when the lease was cleared, false when the update failed
 */
export async function releaseImportLease({
  importId,
  organizationId,
}: ImportLeaseArgs): Promise<boolean> {
  try {
    await db.assetImport.updateMany({
      where: { id: importId, organizationId },
      data: { lockedUntil: null },
    });
    return true;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to release the asset import lease",
        additionalData: { importId, organizationId },
        label: "Asset Import",
      })
    );
    return false;
  }
}
