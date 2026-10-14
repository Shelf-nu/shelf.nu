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
import type { Organization, User } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { ASSET_IMPORT_DRAFT_TTL_HOURS } from "./constants";
import type { StoredImportRow } from "./types";
import { validateContentImportFile } from "./validate.server";
import { enqueueAssetImportStep } from "./worker.server";

export { markImportFailed, markStalledImportIfNeeded } from "./failure.server";

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
