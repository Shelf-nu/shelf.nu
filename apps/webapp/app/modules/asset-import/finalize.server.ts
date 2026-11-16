/**
 * Asset import FINALIZE step
 *
 * The last step of a background import. A row naming both a kit and a
 * custodian means the kit is in that person's custody, so this step assigns
 * kit custody once every asset is in its kit, then marks the import COMPLETED,
 * clears its stored rows and emails the creator.
 *
 * Kit custody goes through the same `bulkAssignKitCustody` flow as the kit
 * pages, one call per custodian. A kit that cannot be assigned never fails the
 * import: it becomes a warning on the import, because by now every asset has
 * already been written.
 *
 * @see {@link file://./worker.server.ts} the job runner that calls this step
 * @see {@link file://./../kit/service.server.ts} `bulkAssignKitCustody`
 */
import { Prisma } from "@prisma/client";
import type { AssetImport } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendAssetImportFinishedEmail } from "~/emails/asset-import-finished";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { bulkAssignKitCustody } from "~/modules/kit/service.server";
import { isLikeShelfError, isPrismaTransientError } from "~/utils/error";
import { appendImportWarnings } from "./chunk-writer.server";
import { resolvedOf, storedRowsOf } from "./progress.server";
import type { ImportWarning, StoredImportRow } from "./types";

/** Kits that go into one custodian's custody. */
type CustodyGroup = {
  custodianId: string;
  /** Kit id to the first row that names the kit. */
  kits: Map<string, { name: string; row: StoredImportRow }>;
};

/**
 * Groups the rows that carry both a kit and a custodian by custodian. Names
 * are resolved through the PREPARE maps, which key kits and custodians by the
 * trimmed cell.
 *
 * @param rows - Every stored row of the import
 * @param kits - Kit name to id
 * @param teamMembers - Custodian name to team member id
 * @returns One group per custodian
 */
function groupKitsByCustodian(
  rows: StoredImportRow[],
  kits: Record<string, string>,
  teamMembers: Record<string, string>
): CustodyGroup[] {
  const groups = new Map<string, CustodyGroup>();

  for (const row of rows) {
    const kitName = row.kit?.trim();
    const custodianName = row.custodian?.trim();
    if (!kitName || !custodianName) continue;

    const kitId = kits[kitName];
    const custodianId = teamMembers[custodianName];
    if (!kitId || !custodianId) continue;

    let group = groups.get(custodianId);
    if (!group) {
      group = { custodianId, kits: new Map() };
      groups.set(custodianId, group);
    }
    if (!group.kits.has(kitId)) {
      group.kits.set(kitId, { name: kitName, row });
    }
  }

  return [...groups.values()];
}

/**
 * The reason shown in a kit custody warning.
 *
 * @param cause - What `bulkAssignKitCustody` threw
 * @returns A sentence fragment without a trailing full stop
 */
function custodyFailureReason(cause: unknown): string {
  const message =
    isLikeShelfError(cause) && cause.message
      ? cause.message
      : "something went wrong";
  return message.trim().replace(/\.+$/, "");
}

/**
 * Whether a custody failure is a passing database problem (pool exhausted,
 * server unreachable) anywhere in its cause chain. Those must fail the step so
 * pg-boss retries it; turning them into a warning would leave the kit without
 * custody for good.
 *
 * @param cause - What `bulkAssignKitCustody` threw
 */
function isTransientFailure(cause: unknown): boolean {
  let current: unknown = cause;
  // Cause chains are short; the bound only guards against a cycle.
  for (let depth = 0; depth < 10 && current; depth++) {
    if (isPrismaTransientError(current)) return true;
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return false;
}

/**
 * Builds the warning for a kit whose custody could not be assigned.
 *
 * @param kit - The kit's name and the first row naming it
 * @param reason - Why the assignment failed, without a trailing full stop
 * @returns The warning stored on the import
 */
function kitCustodyWarning(
  kit: { name: string; row: StoredImportRow },
  reason: string
): ImportWarning {
  return {
    row: kit.row.rowNumber,
    title: kit.row.title,
    message: `Custody for kit "${kit.name}" was not assigned: ${reason}.`,
  };
}

/**
 * Assigns kit custody for the import's kit rows and returns a warning per kit
 * that could not be assigned. Kits that already have custody are skipped, so
 * a retried FINALIZE does not assign twice.
 *
 * @param assetImport - The import
 * @returns Warnings for kits left without custody
 * @throws The custody error when it is a transient database failure, so the
 * step is retried
 */
async function assignKitCustody(
  assetImport: AssetImport
): Promise<ImportWarning[]> {
  const { organizationId, createdById: userId } = assetImport;
  const resolved = resolvedOf(assetImport);
  const groups = groupKitsByCustodian(
    storedRowsOf(assetImport),
    resolved.kits,
    resolved.teamMembers
  );
  if (groups.length === 0) return [];

  const allKitIds = groups.flatMap((g) => [...g.kits.keys()]);
  const [withCustody, custodians] = await Promise.all([
    db.kitCustody.findMany({
      where: { kitId: { in: allKitIds }, kit: { organizationId } },
      select: { kitId: true },
    }),
    db.teamMember.findMany({
      where: {
        id: { in: groups.map((g) => g.custodianId) },
        organizationId,
        // A soft-deleted member counts as gone, as in every custody flow.
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
  ]);
  const alreadyInCustody = new Set(withCustody.map((c) => c.kitId));
  const custodianNames = new Map(custodians.map((c) => [c.id, c.name]));

  const warnings: ImportWarning[] = [];

  for (const group of groups) {
    const pending = [...group.kits].filter(
      ([kitId]) => !alreadyInCustody.has(kitId)
    );
    if (pending.length === 0) continue;

    const custodianName = custodianNames.get(group.custodianId);
    if (custodianName === undefined) {
      // The custodian was deleted after PREPARE created or found them.
      for (const [, kit] of pending) {
        warnings.push(kitCustodyWarning(kit, "the custodian no longer exists"));
      }
      continue;
    }

    const assign = (kitIds: string[]) =>
      bulkAssignKitCustody({
        kitIds,
        organizationId,
        custodianId: group.custodianId,
        custodianName,
        userId,
        // The import is gated on `asset: import`, and the kit ids are explicit
        // (never ALL_SELECTED_KEY), so no custodian filter is ever built.
        allowedTeamMemberIds: "all",
      });

    try {
      await assign(pending.map(([kitId]) => kitId));
    } catch {
      // One bad kit fails the whole call, so retry kit by kit to assign the
      // rest and name the ones that still fail.
      for (const [kitId, kit] of pending) {
        try {
          await assign([kitId]);
        } catch (cause) {
          if (isTransientFailure(cause)) throw cause;
          warnings.push(kitCustodyWarning(kit, custodyFailureReason(cause)));
        }
      }
    }
  }

  return warnings;
}

/**
 * Runs FINALIZE for an import the caller holds the lease on.
 *
 * @param assetImport - The import as loaded by the job runner
 * @throws {ShelfError} When reading the kits or completing the import fails
 */
export async function runFinalizeStep(assetImport: AssetImport): Promise<void> {
  const { id: importId, organizationId } = assetImport;

  await db.assetImport.updateMany({
    where: { id: importId, organizationId, status: "RUNNING" },
    data: { phase: "FINALIZE" },
  });

  const warnings = await assignKitCustody(assetImport);

  // Warnings and completion commit together, so a retry after a failed
  // completion does not store the same warnings twice.
  const completed = await db.$transaction(async (tx) => {
    await appendImportWarnings(tx, importId, warnings);
    return tx.assetImport.updateMany({
      where: { id: importId, organizationId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        // SQL NULL, not a JSON null: the rows are gone, not an empty value.
        rows: Prisma.DbNull,
      },
    });
  });

  if (completed.count === 1) {
    // Counts only, no personal data: closes the import funnel in analytics.
    captureServerEvent({
      distinctId: assetImport.createdById,
      event: "import_completed",
      properties: { organizationId, rows: assetImport.totalRows },
    });
    await sendAssetImportFinishedEmail({
      importId,
      organizationId,
      outcome: "completed",
    });
  }
}
