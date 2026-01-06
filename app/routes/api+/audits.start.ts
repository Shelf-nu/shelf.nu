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

    const { name, description, assetIds, assignee } = parseData(
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
      assignee,
    });

    // If assigned to someone else, redirect to overview page
    // If assigned to self or no assignee, redirect to scan page
    const isAssignedToOther = assignee && assignee !== userId;
    const redirectPath = isAssignedToOther ? "overview" : "scan";

    return data(
      payload({
        success: true,
        redirectTo: `/audits/${session.id}/${redirectPath}`,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
