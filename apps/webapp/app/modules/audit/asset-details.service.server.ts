import type { AuditNote, AuditAsset, User } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  create,
  findFirst,
  findMany,
  update,
  remove as removeRecord,
  count,
} from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";

const label: "Audit" = "Audit";

/**
 * Creates a note for a specific asset within an audit session.
 * These notes are tied to both the audit session and a specific asset.
 *
 * @param content - The note content
 * @param userId - The user creating the note
 * @param auditSessionId - The audit session ID
 * @param auditAssetId - The audit asset ID (from AuditAsset model)
 */
export async function createAuditAssetNote({
  content,
  userId,
  auditSessionId,
  auditAssetId,
}: {
  content: string;
  userId: User["id"];
  auditSessionId: string;
  auditAssetId: AuditAsset["id"];
}) {
  try {
    const note = await create(db, "AuditNote", {
      content,
      type: "COMMENT",
      userId,
      auditSessionId,
      auditAssetId,
    });

    // Fetch the related user
    const user = await findFirst(db, "User", {
      where: { id: userId },
      select: "id, firstName, lastName, email, profilePicture",
    });

    return { ...note, user };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create asset note",
      additionalData: { userId, auditSessionId, auditAssetId },
      label,
    });
  }
}

/**
 * Updates an existing asset note.
 * Only the user who created the note can update it.
 *
 * @param noteId - The note ID to update
 * @param content - The new note content
 * @param userId - The user updating the note (must match creator)
 */
export async function updateAuditAssetNote({
  noteId,
  content,
  userId,
}: {
  noteId: AuditNote["id"];
  content: string;
  userId: User["id"];
}) {
  try {
    // First verify the note exists and user owns it
    const existingNote = await findFirst(db, "AuditNote", {
      where: {
        id: noteId,
        userId,
        auditAssetId: { not: null }, // Ensure it's an asset-specific note
      },
    });

    if (!existingNote) {
      throw new ShelfError({
        cause: null,
        message:
          "Asset note not found or you don't have permission to update it",
        additionalData: { noteId, userId },
        label,
        status: 404,
      });
    }

    const updatedNote = await update(db, "AuditNote", {
      where: { id: noteId },
      data: { content },
    });

    // Fetch the related user
    const user = await findFirst(db, "User", {
      where: { id: updatedNote.userId },
      select: "id, firstName, lastName, email, profilePicture",
    });

    return { ...updatedNote, user };
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Failed to update asset note",
      additionalData: { noteId, userId },
      label,
    });
  }
}

/**
 * Deletes an asset note.
 * Only the user who created the note can delete it.
 *
 * @param noteId - The note ID to delete
 * @param userId - The user deleting the note (must match creator)
 */
export async function deleteAuditAssetNote({
  noteId,
  userId,
}: {
  noteId: AuditNote["id"];
  userId: User["id"];
}) {
  try {
    // First verify the note exists and user owns it
    const existingNote = await findFirst(db, "AuditNote", {
      where: {
        id: noteId,
        userId,
        auditAssetId: { not: null }, // Ensure it's an asset-specific note
      },
    });

    if (!existingNote) {
      throw new ShelfError({
        cause: null,
        message:
          "Asset note not found or you don't have permission to delete it",
        additionalData: { noteId, userId },
        label,
        status: 404,
      });
    }

    const [deleted] = await removeRecord(db, "AuditNote", { id: noteId });
    return deleted;
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Failed to delete asset note",
      additionalData: { noteId, userId },
      label,
    });
  }
}

/**
 * Gets all notes for a specific asset within an audit session.
 * Returns notes ordered by creation date (newest first).
 *
 * @param auditSessionId - The audit session ID
 * @param auditAssetId - The audit asset ID
 */
export async function getAuditAssetNotes({
  auditSessionId,
  auditAssetId,
}: {
  auditSessionId: string;
  auditAssetId: AuditAsset["id"];
}) {
  try {
    const notes = await findMany(db, "AuditNote", {
      where: {
        auditSessionId,
        auditAssetId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Fetch related users for all notes
    const userIds = [...new Set(notes.map((n) => n.userId))];
    const users = userIds.length
      ? await findMany(db, "User", {
          where: { id: { in: userIds } },
          select: "id, firstName, lastName, email, profilePicture",
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return notes.map((note) => ({
      ...note,
      user: userMap.get(note.userId) || null,
    }));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch asset notes",
      additionalData: { auditSessionId, auditAssetId },
      label,
    });
  }
}

/**
 * Gets counts of notes and images for a specific audit asset.
 * Used to display badge indicators in the UI.
 *
 * @param auditSessionId - The audit session ID
 * @param auditAssetId - The audit asset ID
 */
export async function getAuditAssetDetailsCounts({
  auditSessionId,
  auditAssetId,
}: {
  auditSessionId: string;
  auditAssetId: AuditAsset["id"];
}) {
  try {
    const [notesCount, imagesCount] = await Promise.all([
      count(db, "AuditNote", {
        auditSessionId,
        auditAssetId,
      }),
      count(db, "AuditImage", {
        auditSessionId,
        auditAssetId,
      }),
    ]);

    return { notesCount, imagesCount };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch asset details counts",
      additionalData: { auditSessionId, auditAssetId },
      label,
    });
  }
}
