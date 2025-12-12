import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

import { BulkStartAuditSchema } from "~/components/assets/bulk-start-audit-dialog";
import { createAuditSession } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
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

    const { session } = await createAuditSession({
      name,
      description: sanitizedDescription,
      assetIds,
      organizationId,
      createdById: userId,
      assigneeIds,
    });

    return data(
      payload({
        success: true,
        redirectTo: `/audits/${session.id}/scan`,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
