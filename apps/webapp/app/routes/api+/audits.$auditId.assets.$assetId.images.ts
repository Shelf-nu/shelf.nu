import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import {
  deleteAuditImage,
  getAuditImages,
} from "~/modules/audit/image.service.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";
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
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
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

    // `audit: read` authorizes reading audits in general, never THIS audit.
    // Without an assignment check a BASE or SELF_SERVICE member could read the
    // evidence attached to any audit in the workspace, including ones they
    // were never assigned to. ADMIN/OWNER are unrestricted.
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId,
      isSelfServiceOrBase,
    });

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
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { auditId, assetId } = getParams(
      params,
      z.object({ auditId: z.string(), assetId: z.string() }),
      { additionalData: { userId } }
    );

    // Deleting evidence is destructive and irreversible — the storage objects
    // go too — so the same assignment rule as the read applies here.
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId,
      isSelfServiceOrBase,
    });

    const { intent, imageId } = parseData(
      await request.formData(),
      z.object({
        intent: z.enum(["delete"]),
        imageId: z.string(),
      }),
      { additionalData: { userId, auditId } }
    );

    if (intent === "delete") {
      // `auditSessionId` and `auditAssetId` bind the caller-supplied `imageId`
      // to the parent named in the URL. Without them the org filter was the
      // only constraint, so this route could delete an image belonging to an
      // entirely different audit.
      await deleteAuditImage({
        imageId,
        organizationId,
        auditSessionId: auditId,
        auditAssetId: assetId,
      });
      return data(payload({ success: true }));
    }

    throw new Error("Invalid intent");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
