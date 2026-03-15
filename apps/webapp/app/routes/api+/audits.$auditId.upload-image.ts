import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { queryRaw, sql } from "~/database/sql.server";
import { createAuditAssetImagesAddedNote } from "~/modules/audit/helpers.server";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { requireAuditAssigneeForBaseSelfService } from "~/modules/audit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { getParams, payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
      additionalData: { userId },
    });

    // Enforce assignee access for BASE/SELF_SERVICE roles on audit mutations.
    const auditRows = await queryRaw<{
      id: string;
      organizationId: string;
      assignmentUserId: string | null;
    }>(
      db,
      sql`SELECT a."id", a."organizationId", aa."userId" AS "assignmentUserId"
          FROM "AuditSession" a
          LEFT JOIN "AuditAssignment" aa ON aa."auditSessionId" = a."id"
          WHERE a."id" = ${auditId}`
    );

    const audit =
      auditRows.length > 0
        ? {
            id: auditRows[0].id,
            organizationId: auditRows[0].organizationId,
            assignments: auditRows
              .filter((r) => r.assignmentUserId !== null)
              .map((r) => ({ userId: r.assignmentUserId! })),
          }
        : null;

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

    // Parse form data to extract auditAssetId if present
    const formData = await request.clone().formData();
    const auditAssetId = formData.get("auditAssetId") as string | null;

    const result = await uploadAuditImage({
      request,
      auditSessionId: auditId,
      organizationId,
      uploadedById: userId,
      auditAssetId: auditAssetId || undefined,
    });

    if (auditAssetId && result?.id) {
      // Mirror the details flow by creating an automatic activity note.
      await db.$transaction(async (tx) => {
        await createAuditAssetImagesAddedNote({
          auditSessionId: auditId,
          auditAssetId,
          userId,
          imageIds: [result.id],
          tx,
        });
      });
    }

    sendNotification({
      title: "Image uploaded",
      message: "Your audit image has been uploaded",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return data(payload({ success: true, image: result }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
