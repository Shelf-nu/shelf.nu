import type { AuditNote, User, AuditSession } from "@shelf/database";
import { db } from "~/database/db.server";
import { create, findMany } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";

const label = "Audit";

/**
 * Creates a note for an audit session.
 *
 * Notes can be:
 * - COMMENT: User-added comments (e.g., completion notes)
 * - UPDATE: System-generated updates (e.g., status changes)
 */
export async function createAuditNote({
  content,
  type,
  userId,
  auditSessionId,
}: Pick<AuditNote, "content"> & {
  type?: AuditNote["type"];
  userId: User["id"];
  auditSessionId: AuditSession["id"];
}) {
  try {
    return await create(db, "AuditNote", {
      content,
      type: type || "COMMENT",
      userId,
      auditSessionId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating an audit note",
      additionalData: { type, userId, auditSessionId },
      label,
    });
  }
}

/**
 * Gets all notes for an audit session, ordered by creation date (newest first).
 */
export async function getAuditNotes({
  auditSessionId,
}: {
  auditSessionId: AuditSession["id"];
}) {
  try {
    // Fetch notes
    const notes = await findMany(db, "AuditNote", {
      where: { auditSessionId },
      orderBy: { createdAt: "desc" },
    });

    // Fetch users for all notes
    const userIds = [...new Set(notes.map((n) => n.userId))];
    const users = userIds.length
      ? await findMany(db, "User", {
          where: { id: { in: userIds } },
          select: "id, firstName, lastName, email, profilePicture",
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Fetch audit asset info for notes that have auditAssetId
    const auditAssetIds = [
      ...new Set(notes.map((n) => n.auditAssetId).filter(Boolean)),
    ] as string[];
    const auditAssets = auditAssetIds.length
      ? await findMany(db, "AuditAsset", {
          where: { id: { in: auditAssetIds } },
          select: "id, assetId",
        })
      : [];

    // Fetch related assets
    const assetIds = auditAssets.map((aa) => aa.assetId);
    const assets = assetIds.length
      ? await findMany(db, "Asset", {
          where: { id: { in: assetIds } },
          select: "id, title",
        })
      : [];
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const auditAssetMap = new Map(
      auditAssets.map((aa) => [
        aa.id,
        {
          id: aa.id,
          asset: assetMap.get(aa.assetId) || null,
        },
      ])
    );

    // Combine results
    return notes.map((note) => ({
      ...note,
      user: userMap.get(note.userId) || null,
      auditAsset: note.auditAssetId
        ? auditAssetMap.get(note.auditAssetId) || null
        : null,
    }));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching audit notes",
      additionalData: { auditSessionId },
      label,
    });
  }
}
