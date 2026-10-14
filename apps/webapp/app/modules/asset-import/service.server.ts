/**
 * Asset import service.
 *
 * Moves a stored DRAFT import into the queue. Starting the import is the only
 * step that writes; everything before it (upload, preview) only reads.
 *
 * @see {@link file://./preview.server.ts}
 * @see {@link file://./worker.server.ts}
 */
import type { Organization, User } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { ASSET_IMPORT_DRAFT_TTL_HOURS } from "./constants";
import type { StoredImportRow } from "./types";
import { validateContentImportFile } from "./validate.server";
import { enqueueAssetImportStep } from "./worker.server";

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
    const original = isLikeShelfError(cause) ? cause.cause : cause;
    if (
      original instanceof PrismaClientKnownRequestError &&
      original.code === "P2002"
    ) {
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
