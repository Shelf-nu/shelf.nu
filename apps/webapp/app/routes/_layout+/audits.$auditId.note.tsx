import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { MarkdownNoteSchema } from "~/components/notes/markdown-note-form";
import { db } from "~/database/db.server";
import { remove } from "~/database/query-helpers.server";
import { queryRaw, sql } from "~/database/sql.server";
import { createAuditNote } from "~/modules/audit/note-service.server";
import { requireAuditAssigneeForBaseSelfService } from "~/modules/audit/service.server";
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
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.auditNote,
      action: PermissionAction.create,
    });

    const { organizationId, isSelfServiceOrBase } = permissionResult;

    // Validate that the audit belongs to the user's organization
    const auditRows = await queryRaw<{
      id: string;
      organizationId: string;
      assignments: Array<{ userId: string }>;
    }>(
      db,
      sql`
        SELECT
          a."id",
          a."organizationId",
          COALESCE(
            json_agg(json_build_object('userId', sa."userId"))
            FILTER (WHERE sa."userId" IS NOT NULL),
            '[]'
          ) AS "assignments"
        FROM "AuditSession" a
        LEFT JOIN "AuditAssignment" sa ON sa."auditSessionId" = a."id"
        WHERE a."id" = ${auditId}
        GROUP BY a."id"
      `
    );

    const audit = auditRows[0] ?? null;

    if (!audit || audit.organizationId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found or access denied",
        additionalData: { userId, auditId },
        label: "Audit",
        status: 404,
      });
    }

    requireAuditAssigneeForBaseSelfService({
      audit,
      userId,
      isSelfServiceOrBase,
      auditId,
    });

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

        await remove(db, "AuditNote", {
          id: noteId,
          userId, // Ensure user can only delete their own notes
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
