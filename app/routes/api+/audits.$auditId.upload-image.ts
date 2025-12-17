import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { makeShelfError } from "~/utils/error";
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
      additionalData: { userId },
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

    return data(payload({ success: true, image: result }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
