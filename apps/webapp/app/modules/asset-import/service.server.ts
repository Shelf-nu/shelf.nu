/**
 * Asset import service.
 *
 * Moves a stored DRAFT import into the queue, and puts a FAILED import back
 * on it. Starting the import is the only step that writes; everything before
 * it (upload, preview) only reads. Also exposes the failure and stall helpers
 * the status reads use.
 *
 * @see {@link file://./preview.server.ts}
 * @see {@link file://./worker.server.ts}
 * @see {@link file://./failure.server.ts}
 */
import type {
  AssetImport,
  AssetImportPhase,
  AssetImportStatus,
  Organization,
  Prisma,
  User,
} from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { ASSET_IMPORT_DRAFT_TTL_HOURS } from "./constants";
import { markImportFailed, markStalledImportIfNeeded } from "./failure.server";
import type {
  AssetImportDetailsPayload,
  AssetImportStatusPayload,
  ImportWarning,
  StoredImportRow,
} from "./types";
import { validateContentImportFile } from "./validate.server";
import { enqueueAssetImportStep } from "./worker.server";

export { markImportFailed, markStalledImportIfNeeded };

/**
 * Whether an error is the partial unique index on active imports refusing a
 * second QUEUED or RUNNING import in the workspace.
 *
 * @param cause - What the status update threw
 */
function isActiveImportConflict(cause: unknown): boolean {
  const original = isLikeShelfError(cause) ? cause.cause : cause;
  return (
    original instanceof PrismaClientKnownRequestError &&
    original.code === "P2002"
  );
}

/** The 409 raised when the workspace already has an active import. */
function anotherImportRunning(): ShelfError {
  return new ShelfError({
    cause: null,
    message:
      "Another import is already running in this workspace. Wait for it to finish.",
    label: "Asset Import",
    status: 409,
    shouldBeCaptured: false,
  });
}

/**
 * Confirms a DRAFT import: re-validates its stored rows against the
 * workspace as it is now, marks it QUEUED and sends the PREPARE step.
 *
 * @param args.importId - The draft to start
 * @param args.organizationId - Active workspace; the draft must belong to it
 * @param args.userId - The user confirming; must be the one who uploaded
 * @returns The id of the queued import
 * @throws {ShelfError} 404 when no such draft exists for this user and
 * workspace, 400 when the draft expired or its rows no longer validate, 409
 * when another import is queued or running in the workspace or this draft was
 * already confirmed, and the queue's
 * error when the PREPARE step cannot be sent (the draft is restored first)
 */
export async function confirmAssetImport({
  importId,
  organizationId,
  userId,
}: {
  importId: string;
  organizationId: Organization["id"];
  userId: User["id"];
}): Promise<{ importId: string }> {
  const draft = await db.assetImport.findFirst({
    where: {
      id: importId,
      organizationId,
      createdById: userId,
      status: "DRAFT",
    },
  });

  if (!draft) {
    throw new ShelfError({
      cause: null,
      message: "Import not found. Upload the file again.",
      label: "Asset Import",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const ageMs = Date.now() - draft.createdAt.getTime();
  if (ageMs > ASSET_IMPORT_DRAFT_TTL_HOURS * 60 * 60 * 1000) {
    throw new ShelfError({
      cause: null,
      message: "This preview has expired. Upload the file again.",
      label: "Asset Import",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const active = await db.assetImport.findFirst({
    where: { organizationId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });

  if (active) {
    throw anotherImportRunning();
  }

  // The workspace may have changed since the preview (a QR code claimed, a
  // custom field retyped), so the stored rows are checked again.
  await validateContentImportFile({
    data: draft.rows as unknown as StoredImportRow[],
    organizationId,
    userId,
    canUseBarcodes: draft.canUseBarcodes,
  });

  // The partial unique index on active imports turns a lost race with another
  // draft's confirm into P2002; a lost race on this same draft matches no row.
  let claimed: { count: number };
  try {
    claimed = await db.assetImport.updateMany({
      where: { id: importId, organizationId, status: "DRAFT" },
      data: { status: "QUEUED", phase: "PREPARE", confirmedAt: new Date() },
    });
  } catch (cause) {
    if (isActiveImportConflict(cause)) {
      throw anotherImportRunning();
    }
    throw cause;
  }

  if (claimed.count === 0) {
    throw new ShelfError({
      cause: null,
      message: "This import has already been confirmed.",
      label: "Asset Import",
      status: 409,
      shouldBeCaptured: false,
    });
  }

  try {
    await enqueueAssetImportStep({ importId, step: "PREPARE" });
  } catch (cause) {
    // Back to DRAFT so the user can press Import again.
    await db.assetImport.updateMany({
      where: { id: importId, organizationId, status: "QUEUED" },
      data: { status: "DRAFT" },
    });
    throw cause;
  }

  return { importId };
}

/**
 * Resumes a FAILED import: marks it QUEUED again and sends PREPARE. PREPARE
 * recreates anything deleted since, checks the creator's permission again and
 * continues at the chunk holding the first unwritten row.
 *
 * @param args.importId - The failed import
 * @param args.organizationId - Active workspace; the import must belong to it
 * @returns The id of the queued import
 * @throws {ShelfError} 404 when no failed import with this id exists in the
 * workspace, 409 when another import is queued or running in the workspace or
 * this one was already resumed, and the queue's error when PREPARE cannot be
 * sent (the import is put back to FAILED first)
 */
export async function resumeAssetImport({
  importId,
  organizationId,
}: {
  importId: string;
  organizationId: Organization["id"];
}): Promise<{ importId: string }> {
  const failed = await db.assetImport.findFirst({
    where: { id: importId, organizationId, status: "FAILED" },
    select: { id: true, errorMessage: true },
  });

  if (!failed) {
    throw new ShelfError({
      cause: null,
      message: "There is no stopped import to resume.",
      label: "Asset Import",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const active = await db.assetImport.findFirst({
    where: { organizationId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });

  if (active) {
    throw anotherImportRunning();
  }

  let claimed: { count: number };
  try {
    claimed = await db.assetImport.updateMany({
      where: { id: importId, organizationId, status: "FAILED" },
      data: {
        status: "QUEUED",
        phase: "PREPARE",
        lockedUntil: null,
        errorMessage: null,
      },
    });
  } catch (cause) {
    if (isActiveImportConflict(cause)) {
      throw anotherImportRunning();
    }
    throw cause;
  }

  if (claimed.count === 0) {
    throw new ShelfError({
      cause: null,
      message: "This import has already been resumed.",
      label: "Asset Import",
      status: 409,
      shouldBeCaptured: false,
    });
  }

  try {
    await enqueueAssetImportStep({ importId, step: "PREPARE" });
  } catch (cause) {
    // Back to FAILED with its reason so the user can press Resume again.
    await db.assetImport.updateMany({
      where: { id: importId, organizationId, status: "QUEUED" },
      data: { status: "FAILED", errorMessage: failed.errorMessage },
    });
    throw cause;
  }

  return { importId };
}

/**
 * Columns a status read selects. Never `rows` or `resolved`, which hold the
 * whole file and are far larger than a poll should carry, and never
 * `warnings`, which only the status page needs.
 */
const STATUS_SELECT = {
  id: true,
  organizationId: true,
  createdById: true,
  status: true,
  phase: true,
  fileName: true,
  totalRows: true,
  processedRows: true,
  errorMessage: true,
  warningCount: true,
  completedAt: true,
  updatedAt: true,
} as const satisfies Prisma.AssetImportSelect;

/** {@link STATUS_SELECT} plus the stored warnings, for the status page. */
const STATUS_WITH_WARNINGS_SELECT = {
  ...STATUS_SELECT,
  warnings: true,
} as const satisfies Prisma.AssetImportSelect;

/** The 404 raised when an import is missing, in another workspace or a draft. */
function importNotFound(): ShelfError {
  return new ShelfError({
    cause: null,
    message: "Import not found.",
    label: "Asset Import",
    status: 404,
    shouldBeCaptured: false,
  });
}

/**
 * Reads one non-draft import of a workspace. The result type is declared by
 * hand so callers never infer from the Prisma select.
 *
 * @param args.importId - The import to read
 * @param args.organizationId - Workspace the import must belong to
 * @param args.withWarnings - Also select the stored `warnings`
 * @returns The row, or null when missing, in another workspace or a draft
 */
async function findVisibleImportRow({
  importId,
  organizationId,
  withWarnings,
}: {
  importId: string;
  organizationId: Organization["id"];
  withWarnings: boolean;
}): Promise<StatusRow | null> {
  const where = {
    id: importId,
    organizationId,
    status: { not: "DRAFT" },
  } as const;
  if (withWarnings) {
    return db.assetImport.findFirst({
      where,
      select: STATUS_WITH_WARNINGS_SELECT,
    }) as Promise<StatusRow | null>;
  }
  return db.assetImport.findFirst({
    where,
    select: STATUS_SELECT,
  }) as Promise<StatusRow | null>;
}

/**
 * Reads the newest import the app shell should surface for a viewer.
 *
 * @param args.userId - The viewer
 * @param args.organizationId - Active workspace
 * @param args.recentSince - Oldest `updatedAt` a finished import may have
 * @returns The row, or null when nothing qualifies
 */
async function findActiveImportRow({
  userId,
  organizationId,
  recentSince,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  recentSince: Date;
}): Promise<StatusRow | null> {
  return db.assetImport.findFirst({
    where: {
      organizationId,
      OR: [
        { status: { in: ["QUEUED", "RUNNING"] } },
        {
          status: { in: ["COMPLETED", "FAILED"] },
          createdById: userId,
          updatedAt: { gt: recentSince },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: STATUS_SELECT,
  }) as Promise<StatusRow | null>;
}

/**
 * Loads an import that has left DRAFT in the active workspace and fails it
 * first if it stalled.
 *
 * @param args.importId - The import to load
 * @param args.organizationId - Active workspace; other workspaces' imports are
 * reported as missing
 * @param args.withWarnings - Also select the stored `warnings`
 * @returns The import as it is after the stall check
 * @throws {ShelfError} 404 when it does not exist in the workspace or is
 * still a DRAFT (a draft is only visible through the upload flow)
 */
async function loadVisibleImport({
  importId,
  organizationId,
  withWarnings,
}: {
  importId: string;
  organizationId: Organization["id"];
  withWarnings: boolean;
}): Promise<SettledImport> {
  const found = await findVisibleImportRow({
    importId,
    organizationId,
    withWarnings,
  });

  if (!found) throw importNotFound();

  return settleLoadedImport(found);
}

/**
 * Plain shape of a row selected with {@link STATUS_SELECT} (plus `warnings`
 * when asked for). Declared by hand so callers never infer types from the
 * Prisma select.
 */
type StatusRow = {
  id: string;
  organizationId: string;
  createdById: string;
  status: AssetImportStatus;
  phase: AssetImportPhase;
  fileName: string | null;
  totalRows: number;
  processedRows: number;
  errorMessage: string | null;
  warningCount: number;
  completedAt: Date | null;
  updatedAt: Date;
  warnings?: unknown;
};

/** Compile-time check: every {@link StatusRow} column is selected (and no more). */
const _statusSelectCoversRow: Record<
  Exclude<keyof StatusRow, "warnings">,
  true
> = STATUS_SELECT;
void _statusSelectCoversRow;

/** A {@link StatusRow} after the stall check, as {@link toStatusPayload} reads it. */
type SettledImport = {
  status: AssetImportStatus;
  phase: AssetImportPhase;
  errorMessage: string | null;
  completedAt: Date | null;
  processedRows: number;
  warningCount: number;
  warnings: unknown;
  found: StatusRow;
};

/**
 * Runs the stall check on a row selected with {@link STATUS_SELECT} and
 * shapes the result for {@link toStatusPayload}.
 *
 * @param found - A row selected with `STATUS_SELECT` (optionally `warnings`)
 * @returns The import as it is after the stall check
 */
async function settleLoadedImport(found: StatusRow): Promise<SettledImport> {
  // why: the stall check reads only id, organizationId, status and updatedAt,
  // all selected above; the full row type is not needed to run it.
  const checked = await markStalledImportIfNeeded(
    found as unknown as AssetImport
  );

  return {
    status: checked.status,
    phase: checked.phase,
    errorMessage: checked.errorMessage,
    completedAt: checked.completedAt,
    processedRows: checked.processedRows,
    warningCount: checked.warningCount,
    warnings: checked.warnings,
    found,
  };
}

/**
 * Builds the status payload from a loaded import.
 *
 * @param loaded - Result of {@link settleLoadedImport}
 * @param userId - The viewer; decides `isMine`
 */
function toStatusPayload(
  loaded: SettledImport,
  userId: User["id"]
): AssetImportStatusPayload {
  const { found } = loaded;
  return {
    id: found.id,
    status: loaded.status,
    phase: loaded.phase,
    fileName: found.fileName,
    totalRows: found.totalRows,
    processedRows: loaded.processedRows,
    errorMessage: loaded.errorMessage,
    warningCount: loaded.warningCount,
    completedAt: loaded.completedAt ? loaded.completedAt.toISOString() : null,
    isMine: found.createdById === userId,
  };
}

/**
 * Reads an import's progress for the status endpoint and the progress UI.
 * Fails the import first when it stalled. Any member with import permission
 * can read any import in the workspace; `isMine` tells the UI whether the
 * viewer started it.
 *
 * @param args.importId - The import to read
 * @param args.organizationId - Active workspace
 * @param args.userId - The viewer
 * @returns The status payload; never rows or warnings
 * @throws {ShelfError} 404 when the import is not in this workspace or is
 * still a DRAFT
 */
export async function getAssetImportStatus({
  importId,
  organizationId,
  userId,
}: {
  importId: string;
  organizationId: Organization["id"];
  userId: User["id"];
}): Promise<AssetImportStatusPayload> {
  const loaded = await loadVisibleImport({
    importId,
    organizationId,
    withWarnings: false,
  });
  return toStatusPayload(loaded, userId);
}

/**
 * Reads an import's progress plus its stored warnings for the status page.
 *
 * @param args.importId - The import to read
 * @param args.organizationId - Active workspace
 * @param args.userId - The viewer
 * @returns The status payload and the warnings (empty when none are stored)
 * @throws {ShelfError} 404 when the import is not in this workspace or is
 * still a DRAFT
 */
export async function getAssetImportDetails({
  importId,
  organizationId,
  userId,
}: {
  importId: string;
  organizationId: Organization["id"];
  userId: User["id"];
}): Promise<AssetImportDetailsPayload> {
  const loaded = await loadVisibleImport({
    importId,
    organizationId,
    withWarnings: true,
  });
  return {
    ...toStatusPayload(loaded, userId),
    warnings: Array.isArray(loaded.warnings)
      ? (loaded.warnings as unknown as ImportWarning[])
      : [],
  };
}

/** How long the starter keeps seeing the outcome of a finished import. */
const FINISHED_IMPORT_VISIBLE_MINUTES = 10;

/**
 * Finds the import the app shell should surface for a viewer: any import of
 * the workspace that is queued or running (everyone sees it), or one the
 * viewer started that finished in the last
 * {@link FINISHED_IMPORT_VISIBLE_MINUTES} minutes (so the starter sees the
 * outcome once). The most recently updated match wins. Fails a stalled import
 * first. Served by the `(organizationId, status)` index.
 *
 * @param args.userId - The viewer; decides `isMine` and who sees an outcome
 * @param args.organizationId - Active workspace
 * @returns The status payload (never rows or warnings), or null when nothing qualifies
 */
export async function getActiveAssetImport({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<AssetImportStatusPayload | null> {
  const recentSince = new Date(
    Date.now() - FINISHED_IMPORT_VISIBLE_MINUTES * 60 * 1000
  );

  const found = await findActiveImportRow({
    userId,
    organizationId,
    recentSince,
  });

  if (!found) return null;

  return toStatusPayload(await settleLoadedImport(found), userId);
}
