/**
 * User Note Action Route — `/settings/team/users/:userId/note`
 *
 * Handles creating (POST) and deleting (DELETE) admin notes on user profiles.
 * The loader redirects to the notes tab since this route is action-only.
 *
 * IMPORTANT: `params.userId` refers to the **target user** (the user the note is about).
 * `authSession.userId` is the **authenticated admin** (the note author).
 * These must not be confused.
 *
 * Notes are linked to TeamMember (workspace-scoped identity), not User directly.
 * The route resolves User ID → TeamMember ID before calling the service layer.
 *
 * @see {@link file://./settings.team.users.$userId.notes.tsx} for the notes tab loader/component
 * @see {@link file://./../../modules/team-member-note/service.server.ts} for the service layer
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import { db } from "~/database/db.server";
import {
  createTeamMemberNote,
  deleteTeamMemberNote,
} from "~/modules/team-member-note/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getActionMethod,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ userId: z.string() });

/** Redirects to the notes tab — this route only handles actions */
export function loader({ params }: LoaderFunctionArgs) {
  const { userId: targetUserId } = getParams(params, paramsSchema);

  return redirect(`/settings/team/users/${targetUserId}/notes`);
}

/**
 * Handles POST (create note) and DELETE (delete note) actions.
 * Both actions resolve the target user's TeamMember in the current workspace
 * before proceeding, ensuring workspace-scoped note creation.
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  /** The user the note is about — NOT the authenticated admin */
  const { userId: targetUserId } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { organizationId } = await requirePermission({
          userId,
          request,
          entity: PermissionEntity.teamMemberNote,
          action: PermissionAction.create,
        });

        /* Resolve User → TeamMember for workspace-scoped note linking */
        const teamMemberId = await resolveTeamMemberForUser({
          targetUserId,
          organizationId,
        });

        const { content } = parseData(
          await request.formData(),
          MarkdownNoteSchema,
          {
            additionalData: { userId, targetUserId },
          }
        );

        const note = await createTeamMemberNote({
          content,
          teamMemberId,
          organizationId,
          userId,
        });

        sendNotification({
          title: "Note created",
          message: "Your note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ note });
      }
      case "DELETE": {
        const { organizationId } = await requirePermission({
          userId,
          request,
          entity: PermissionEntity.teamMemberNote,
          action: PermissionAction.delete,
        });

        /* Validate the target user exists in this workspace before deleting */
        await resolveTeamMemberForUser({
          targetUserId,
          organizationId,
        });

        const { noteId } = parseData(
          await request.formData(),
          z.object({ noteId: z.string() }),
          {
            additionalData: { userId, targetUserId },
          }
        );

        await deleteTeamMemberNote({
          id: noteId,
          userId,
          organizationId,
        });

        sendNotification({
          title: "Note deleted",
          message: "Your note has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: userId,
        });

        return payload(null);
      }
      default: {
        throw notAllowedMethod(method);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { targetUserId, userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Resolves the TeamMember record for a user in the current workspace.
 * TeamMember is the workspace-scoped identity (Organization → TeamMember → User)
 * used to link notes, consistent with how Custody and Booking work.
 *
 * @param args.targetUserId - The User ID from the route param
 * @param args.organizationId - The current workspace
 * @returns The TeamMember ID for this user in this workspace
 * @throws {ShelfError} 404 if no TeamMember exists for this user in the org
 */
async function resolveTeamMemberForUser({
  targetUserId,
  organizationId,
}: {
  targetUserId: string;
  organizationId: string;
}): Promise<string> {
  /* Filter out soft-deleted team members to prevent stale lookups */
  const teamMember = await db.teamMember.findFirst({
    where: { userId: targetUserId, organizationId, deletedAt: null },
    select: { id: true },
  });

  if (!teamMember) {
    throw new ShelfError({
      cause: null,
      message: "User not found in this workspace",
      status: 404,
      additionalData: { targetUserId, organizationId },
      label: "Team Member Note",
      shouldBeCaptured: false,
    });
  }

  return teamMember.id;
}
