import type { AuditNote, User, AuditSession } from "@prisma/client";
import { sbDb } from "~/database/supabase.server";
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
    const { data, error } = await sbDb
      .from("AuditNote")
      .insert({
        content,
        type: type || "COMMENT",
        userId,
        auditSessionId,
      })
      .select()
      .single();

    if (error) throw error;

    return data;
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
    const { data, error } = await sbDb
      .from("AuditNote")
      .select(
        "*, user:User!userId(id, firstName, lastName, email, profilePicture), auditAsset:AuditAsset!auditAssetId(id, asset:Asset!assetId(id, title))"
      )
      .eq("auditSessionId", auditSessionId)
      .order("createdAt", { ascending: false });

    if (error) throw error;

    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching audit notes",
      additionalData: { auditSessionId },
      label,
    });
  }
}
