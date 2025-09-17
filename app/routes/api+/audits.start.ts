import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { BulkStartAuditSchema } from "~/components/assets/bulk-start-audit-dialog";
import { createAuditSession } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    const formData = await request.formData();

    const { name, description, assetIds, assigneeIds } = parseData(
      formData,
      BulkStartAuditSchema,
      {
        additionalData: { organizationId, userId },
      }
    );

    const sanitizedDescription = description?.trim() || undefined;

    const { session, expectedAssets } = await createAuditSession({
      name,
      description: sanitizedDescription,
      assetIds,
      organizationId,
      createdById: userId,
      assigneeIds,
    });

    const sessionPayload = {
      id: session.id,
      name: session.name,
      targetId: session.targetId,
      contextType:
        typeof session.scopeMeta === "object"
          ? (session.scopeMeta as Record<string, unknown>)?.contextType ?? null
          : null,
      contextName:
        typeof session.scopeMeta === "object"
          ? (session.scopeMeta as Record<string, unknown>)?.contextName ?? null
          : null,
      expectedAssetCount: session.expectedAssetCount,
      foundAssetCount: session.foundAssetCount,
      missingAssetCount: session.missingAssetCount,
      unexpectedAssetCount: session.unexpectedAssetCount,
    };

    return json(
      data({
        success: true,
        auditSession: sessionPayload,
        expectedAssets,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
