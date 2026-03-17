import type { AuditNote, User, AuditSession } from "@prisma/client";
import { db } from "~/database/db.server";
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
    return await db.auditNote.findMany({
      where: {
        auditSessionId,
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
        auditAsset: {
          select: {
            id: true,
            asset: {
              select: {
                id: true,
                title: true,
              },
            },
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
      message: "Something went wrong while fetching audit notes",
      additionalData: { auditSessionId },
      label,
    });
  }
}
