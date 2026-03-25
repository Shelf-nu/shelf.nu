/**
 * My Note Action Route — `/me/note`
 *
 * Handles creating (POST) and deleting (DELETE) admin notes on the
 * authenticated user's own profile. The loader redirects to the notes tab.
 *
 * Unlike the user profile action route (`settings.team.users.$userId.note.tsx`),
 * the target user is always the authenticated user — no URL param needed.
 *
 * @see {@link file://./me.notes.tsx} for the notes tab loader/component
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
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Redirects to the notes tab — this route only handles actions */
export function loader(_args: LoaderFunctionArgs) {
  return redirect("/me/notes");
}

/**
 * Handles POST (create note) and DELETE (delete note) actions
 * on the authenticated user's own profile.
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

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

        /* Resolve the authenticated user's TeamMember in this workspace */
        const teamMemberId = await resolveOwnTeamMember({
          userId,
          organizationId,
        });

        const { content } = parseData(
          await request.formData(),
          MarkdownNoteSchema,
          {
            additionalData: { userId },
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

        const { noteId } = parseData(
          await request.formData(),
          z.object({ noteId: z.string() }),
          {
            additionalData: { userId },
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
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Resolves the authenticated user's own TeamMember record in the current workspace.
 * Filters out soft-deleted team members.
 *
 * @param args.userId - The authenticated user's ID
 * @param args.organizationId - The current workspace
 * @returns The TeamMember ID
 * @throws {ShelfError} 404 if no active TeamMember exists
 */
async function resolveOwnTeamMember({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<string> {
  const teamMember = await db.teamMember.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { id: true },
  });

  if (!teamMember) {
    throw new ShelfError({
      cause: null,
      message: "You are not a member of this workspace",
      status: 404,
      additionalData: { userId, organizationId },
      label: "Team Member Note",
    });
  }

  return teamMember.id;
}
