import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import { db } from "~/database/db.server";
import { createAuditNote } from "~/modules/audit/note-service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  error,
  getActionMethod,
  getParams,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.auditNote,
      action: PermissionAction.create,
    });

    // Validate that the audit belongs to the user's organization
    const audit = await db.auditSession.findUnique({
      where: { id: auditId },
      select: { id: true, organizationId: true },
    });

    if (!audit || audit.organizationId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found or access denied",
        additionalData: { userId, auditId },
        label: "Audit",
        status: 404,
      });
    }

    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { content } = parseData(
          await request.formData(),
          MarkdownNoteSchema,
          {
            additionalData: { userId, auditId },
          }
        );

        sendNotification({
          title: "Note created",
          message: "Your audit note has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        const note = await createAuditNote({
          content,
          type: "COMMENT",
          userId,
          auditSessionId: auditId,
        });

        return data(payload({ note }));
      }
      case "DELETE": {
        const { noteId } = parseData(
          await request.formData(),
          z.object({
            noteId: z.string(),
          }),
          {
            additionalData: { userId, auditId },
          }
        );

        sendNotification({
          title: "Note deleted",
          message: "Your audit note has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        await db.auditNote.delete({
          where: {
            id: noteId,
            userId, // Ensure user can only delete their own notes
          },
        });

        return data(payload(null));
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, {
      userId,
      auditId,
      label: "Audit Note",
    });
    return data(error(reason), { status: reason.status });
  }
}
