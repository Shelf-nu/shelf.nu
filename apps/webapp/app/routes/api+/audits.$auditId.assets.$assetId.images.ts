import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import {
  deleteAuditImage,
  getAuditImages,
} from "~/modules/audit/image.service.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * API route to manage images for a specific audit asset
 * GET - Fetch all images for the asset
 * POST - Delete an image (with intent=delete)
 */

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { auditId, assetId } = getParams(
      params,
      z.object({ auditId: z.string(), assetId: z.string() }),
      { additionalData: { userId } }
    );

    // Fetch images for the specific audit asset
    const images = await getAuditImages({
      auditSessionId: auditId,
      organizationId,
      auditAssetId: assetId,
    });

    return data(payload({ images }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export async function action({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { auditId } = getParams(
      params,
      z.object({ auditId: z.string(), assetId: z.string() }),
      { additionalData: { userId } }
    );

    const { intent, imageId } = parseData(
      await request.formData(),
      z.object({
        intent: z.enum(["delete"]),
        imageId: z.string(),
      }),
      { additionalData: { userId, auditId } }
    );

    if (intent === "delete") {
      await deleteAuditImage({ imageId, organizationId });
      return data(payload({ success: true }));
    }

    throw new Error("Invalid intent");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
