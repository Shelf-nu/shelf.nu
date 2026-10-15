/**
 * Asset import failure
 *
 * Moves an active import to FAILED and emails its creator. Two callers can
 * reach this for the same import at once (the job runner after its last retry,
 * and a status read that finds the import stalled), so the transition is a
 * status-guarded update and only the caller whose update matched sends the
 * email.
 *
 * Kept apart from `service.server.ts` so the job runner can use it without an
 * import cycle (the service imports the runner's queue producer).
 *
 * @see {@link file://./worker.server.ts} the job runner
 * @see {@link file://./service.server.ts} re-exports both functions
 * @see {@link file://./../../emails/asset-import-finished.tsx}
 */
import type { AssetImport } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendAssetImportFinishedEmail } from "~/emails/asset-import-finished";
import { ASSET_IMPORT_STALL_MINUTES } from "./constants";

/** Shown when a QUEUED or RUNNING import stopped moving. */
export const IMPORT_STALLED_MESSAGE =
  "The import stopped unexpectedly. Your progress is saved, use Resume to continue.";

/**
 * Marks a QUEUED or RUNNING import as FAILED. Safe to call more than once and
 * from several places at the same time: an import that already left those
 * states is not touched, and the failure email goes out only once.
 *
 * @param args.importId - The import to fail
 * @param args.organizationId - Workspace that owns the import
 * @param args.errorMessage - User-facing reason, shown on the status page and
 * in the email
 * @returns True when this call moved the import to FAILED
 */
export async function markImportFailed({
  importId,
  organizationId,
  errorMessage,
}: {
  importId: string;
  organizationId: string;
  errorMessage: string;
}): Promise<boolean> {
  const { count } = await db.assetImport.updateMany({
    where: {
      id: importId,
      organizationId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: { status: "FAILED", errorMessage },
  });

  if (count !== 1) return false;

  await sendAssetImportFinishedEmail({
    importId,
    organizationId,
    outcome: "failed",
  });
  return true;
}

/**
 * Fails a QUEUED or RUNNING import that has not moved for
 * `ASSET_IMPORT_STALL_MINUTES`. Confirm, resume, every lease claim and every
 * chunk bump `updatedAt`, so an active import that old has no live step
 * behind it. That covers a QUEUED import whose first job never ran or never
 * claimed it, which would otherwise hold the workspace's single active import
 * slot forever. Status reads call this before they render the import.
 *
 * @param assetImport - The import as just loaded
 * @returns The import unchanged when it is not stalled, otherwise the import
 * as it is after being failed
 */
export async function markStalledImportIfNeeded(
  assetImport: AssetImport
): Promise<AssetImport> {
  const stallBefore = Date.now() - ASSET_IMPORT_STALL_MINUTES * 60 * 1000;
  if (
    (assetImport.status !== "QUEUED" && assetImport.status !== "RUNNING") ||
    assetImport.updatedAt.getTime() >= stallBefore
  ) {
    return assetImport;
  }

  await markImportFailed({
    importId: assetImport.id,
    organizationId: assetImport.organizationId,
    errorMessage: IMPORT_STALLED_MESSAGE,
  });

  const refreshed = await db.assetImport.findFirst({
    where: { id: assetImport.id, organizationId: assetImport.organizationId },
  });
  return refreshed ?? assetImport;
}
