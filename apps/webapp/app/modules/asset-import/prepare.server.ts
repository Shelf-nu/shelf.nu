/**
 * Asset import PREPARE step
 *
 * The first step of a background import. Marks the import RUNNING, claims the
 * file's unclaimed QR codes for the workspace, and finds or creates every
 * category, location, tag, kit, custodian, custom field and asset model the
 * rows name. The resulting name to id maps are stored on the import as
 * `resolved`, which every ROWS chunk reads.
 *
 * Every write here is find-or-create or claim-if-unclaimed, so the step can
 * run again (a retry, or a resume after a failure) and recreates only what was
 * deleted in between.
 *
 * @see {@link file://./worker.server.ts} the job runner that calls this step
 * @see {@link file://./types.ts} `ResolvedImportEntities`
 */
import type { AssetImport, Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { createAssetModelsIfNotExists } from "~/modules/asset-model/service.server";
import { createCategoriesIfNotExists } from "~/modules/category/service.server";
import { createCustomFieldsIfNotExists } from "~/modules/custom-field/service.server";
import { createKitsIfNotExists } from "~/modules/kit/service.server";
import { createLocationsIfNotExists } from "~/modules/location/service.server";
import { claimImportQrCodes } from "~/modules/qr/service.server";
import { createTagsIfNotExists } from "~/modules/tag/service.server";
import { createTeamMemberIfNotExists } from "~/modules/team-member/service.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { nextStepAfter, storedRowsOf } from "./progress.server";
import type { AssetImportJobData, ResolvedImportEntities } from "./types";

/**
 * Whether the user may still import assets in the workspace. The import runs
 * long after the user confirmed it, and their role can change or their
 * membership end in between.
 *
 * @param args.userId - The user who started the import
 * @param args.organizationId - The workspace the import writes to
 * @returns False when the user left the workspace or their role no longer
 * grants `asset: import`
 */
export async function userCanStillImport({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<boolean> {
  const membership = await db.userOrganization.findFirst({
    where: { userId, organizationId },
    select: { roles: true },
  });
  if (!membership) return false;

  return hasPermission({
    userId,
    organizationId,
    roles: membership.roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.import,
  });
}

/**
 * Runs PREPARE for an import the caller holds the lease on.
 *
 * @param assetImport - The import as loaded by the job runner
 * @returns The step to queue next, or null when the import stopped being
 * active while this step ran (nothing more to do)
 * @throws {ShelfError} When claiming QR codes or creating an entity fails
 */
export async function runPrepareStep(
  assetImport: AssetImport
): Promise<AssetImportJobData | null> {
  const { id: importId, organizationId, createdById: userId } = assetImport;
  const rows = storedRowsOf(assetImport);

  const started = await db.assetImport.updateMany({
    where: {
      id: importId,
      organizationId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "RUNNING",
      phase: "PREPARE",
      // A resumed import keeps the time it first started.
      ...(assetImport.startedAt ? {} : { startedAt: new Date() }),
    },
  });
  if (started.count === 0) return null;

  // The codes were validated at confirm; claiming skips any that already
  // belong to a workspace, so this is safe to repeat.
  const qrIdsByRowKey: Record<string, string> = {};
  for (const row of rows) {
    const qrId: unknown = row.qrId;
    if (typeof qrId === "string" && qrId) qrIdsByRowKey[row.key] = qrId;
  }
  await claimImportQrCodes({
    qrIds: [...new Set(Object.values(qrIdsByRowKey))],
    organizationId,
    userId,
  });

  const [
    kits,
    categories,
    locations,
    teamMembers,
    tags,
    { customFields },
    assetModels,
  ] = await Promise.all([
    createKitsIfNotExists({ data: rows, userId, organizationId }),
    createCategoriesIfNotExists({ data: rows, userId, organizationId }),
    createLocationsIfNotExists({ data: rows, userId, organizationId }),
    createTeamMemberIfNotExists({ data: rows, organizationId }),
    createTagsIfNotExists({ data: rows, userId, organizationId }),
    createCustomFieldsIfNotExists({ data: rows, organizationId, userId }),
    createAssetModelsIfNotExists({ data: rows, userId, organizationId }),
  ]);

  const resolved: ResolvedImportEntities = {
    kits: idsOf(kits),
    categories,
    locations,
    teamMembers: idsOf(teamMembers),
    tags,
    customFields: idsOf(customFields),
    assetModels,
    qrIdsByRowKey,
  };

  const stored = await db.assetImport.updateMany({
    where: { id: importId, organizationId, status: "RUNNING" },
    data: {
      resolved: resolved as unknown as Prisma.InputJsonValue,
      phase: "ROWS",
    },
  });
  if (stored.count === 0) return null;

  return nextStepAfter({
    importId,
    processedRows: assetImport.processedRows,
    totalRows: assetImport.totalRows,
  });
}

/**
 * Maps a name to record map to a name to id map.
 *
 * @param records - Records keyed by name
 * @returns The same keys with each record's id
 */
function idsOf(
  records: Record<string, { id: string }>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(records).map(([name, record]) => [name, record.id])
  );
}
