/**
 * Team Member Note Service
 *
 * Handles CRUD operations for admin notes on team member profiles.
 * Notes are workspace-scoped: a note created in Workspace A is invisible in Workspace B.
 * Only admins/owners can create, read, and delete team member notes.
 *
 * Workspace scoping uses the TeamMember model (Organization → TeamMember → User),
 * consistent with how Custody, Booking, and KitCustody handle workspace-scoped entities.
 *
 * Key distinction: each note has two relationships:
 * - `user` (author) — the admin who wrote the note (User model, consistent with all note types)
 * - `teamMember` (target) — the workspace member the note is about (TeamMember model)
 *
 * @see {@link file://./../../routes/_layout+/settings.team.users.$userId.note.tsx} for the route action
 * @see {@link file://./../../components/user/notes/index.tsx} for the UI container
 */
import type { Prisma, TeamMemberNote, User } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Team Member Note";

/** Arguments for creating a team member note */
type CreateTeamMemberNoteArgs = Pick<
  TeamMemberNote,
  "content" | "teamMemberId" | "organizationId"
> & {
  /** Note type — defaults to COMMENT for manual notes, UPDATE for system-generated */
  type?: TeamMemberNote["type"];
  /** The admin (author) who is creating the note. Null for system-generated notes. */
  userId?: User["id"] | null;
};

/**
 * Creates a new note on a team member's profile within a specific workspace.
 *
 * @param args - The note content, target team member, organization, and optional author
 * @returns The created TeamMemberNote record
 * @throws {ShelfError} If the database operation fails
 */
export async function createTeamMemberNote({
  content,
  type = "COMMENT",
  teamMemberId,
  organizationId,
  userId,
}: CreateTeamMemberNoteArgs) {
  try {
    return await db.teamMemberNote.create({
      data: {
        content,
        type,
        teamMember: {
          connect: { id: teamMemberId },
        },
        organization: {
          connect: { id: organizationId },
        },
        ...(userId
          ? {
              user: {
                connect: { id: userId },
              },
            }
          : {}),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating the team member note.",
      additionalData: { teamMemberId, organizationId, userId },
      label,
    });
  }
}

/**
 * Fetches all notes for a team member within a specific workspace.
 *
 * Validates that the team member belongs to the organization before fetching.
 * This is the workspace-scoping enforcement: notes from other workspaces
 * are never returned.
 *
 * @param args.teamMemberId - The team member whose notes to fetch
 * @param args.organizationId - The workspace to scope notes to
 * @returns Notes ordered by createdAt desc, with author firstName/lastName included
 * @throws {ShelfError} 404 if the team member is not found in the organization
 */
export async function getTeamMemberNotes({
  teamMemberId,
  organizationId,
}: Pick<TeamMemberNote, "teamMemberId"> & {
  organizationId: TeamMemberNote["organizationId"];
}) {
  try {
    /* Verify the team member belongs to this workspace.
     * Filter out soft-deleted members for consistency with route-level checks. */
    const teamMember = await db.teamMember.findFirst({
      where: { id: teamMemberId, organizationId, deletedAt: null },
      select: { id: true },
    });

    if (!teamMember) {
      throw new ShelfError({
        cause: null,
        message: "Team member not found in this workspace",
        additionalData: { teamMemberId, organizationId },
        label,
        status: 404,
      });
    }

    return await db.teamMemberNote.findMany({
      where: { teamMemberId, organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
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
      message: "Something went wrong while fetching the team member notes.",
      additionalData: { teamMemberId, organizationId },
      label,
    });
  }
}

/**
 * Deletes a team member note. Only the original author can delete their own notes,
 * and only within the current workspace.
 *
 * Uses `deleteMany` with `id`, `userId`, and `organizationId` in the where clause
 * to enforce both authorship AND workspace scoping. This prevents cross-workspace
 * deletion — an admin who authored notes in multiple workspaces cannot delete
 * a note from Workspace A while operating in Workspace B.
 *
 * Throws a 403 if no matching note was found (wrong author, wrong workspace,
 * or non-existent note) to avoid silent no-ops.
 *
 * @param args.id - The note ID to delete
 * @param args.userId - The requesting user's ID (must be the note author)
 * @param args.organizationId - The current workspace (enforces workspace isolation)
 * @returns Prisma BatchPayload with the count of deleted records
 * @throws {ShelfError} 403 if no note matched (wrong author or workspace)
 * @throws {ShelfError} If the database operation fails
 */
export async function deleteTeamMemberNote({
  id,
  userId,
  organizationId,
}: Pick<TeamMemberNote, "id" | "organizationId"> & { userId: User["id"] }) {
  try {
    const result = await db.teamMemberNote.deleteMany({
      where: { id, userId, organizationId },
    });

    if (result.count === 0) {
      throw new ShelfError({
        cause: null,
        message: "Note not found or you don't have permission to delete it.",
        additionalData: { id, userId, organizationId },
        label,
        status: 403,
      });
    }

    return result;
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the team member note.",
      additionalData: { id, userId, organizationId },
      label,
    });
  }
}

/** A TeamMemberNote with the author's name fields included (supports displayName for SSO users) */
export type TeamMemberNoteWithUser = Prisma.TeamMemberNoteGetPayload<{
  include: {
    user: { select: { firstName: true; lastName: true; displayName: true } };
  };
}>;
