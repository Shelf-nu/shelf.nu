import type { AuditNote, AuditAsset, User } from "@prisma/client";
import { db } from "~/database/db.server";
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
    return await db.auditNote.create({
      data: {
        content,
        type: "COMMENT",
        userId,
        auditSessionId,
        auditAssetId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });
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
    const existingNote = await db.auditNote.findFirst({
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

    return await db.auditNote.update({
      where: { id: noteId },
      data: { content },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });
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
    const existingNote = await db.auditNote.findFirst({
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

    return await db.auditNote.delete({
      where: { id: noteId },
    });
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
    return await db.auditNote.findMany({
      where: {
        auditSessionId,
        auditAssetId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
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
      db.auditNote.count({
        where: {
          auditSessionId,
          auditAssetId,
        },
      }),
      db.auditImage.count({
        where: {
          auditSessionId,
          auditAssetId,
        },
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
