import { data, type ActionFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobileAuditsEnabled,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createAuditAssetImagesAddedNote } from "~/modules/audit/helpers.server";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/audits/image
 *
 * Uploads a single condition photo for a scanned asset within an audit and
 * records the matching note, so the image + note reach the audit PDF report
 * exactly like the webapp. Mirrors the `upload-image` intent in
 * `routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx` (the
 * single-file variant — the companion uploads one photo per request, same
 * as the mobile asset image-upload route).
 *
 * Query params:
 *   - orgId (required): organization ID
 *   - auditSessionId (required)
 *   - auditAssetId (required): the AuditAsset this photo is evidence for
 *   - content (optional): note text to attach alongside the photo
 *
 * Body: multipart/form-data with field `image` (the photo file). The
 * upload pipeline (resize/thumbnail/storage) is shared with the webapp via
 * `uploadAuditImage`.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    await requireMobileAuditsEnabled(organizationId);
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const url = new URL(request.url);
    const auditSessionId = url.searchParams.get("auditSessionId");
    const auditAssetId = url.searchParams.get("auditAssetId");
    const content = url.searchParams.get("content");

    if (!auditSessionId || !auditAssetId) {
      return data(
        {
          error: {
            message: "Missing auditSessionId or auditAssetId query parameter",
          },
        },
        { status: 400 }
      );
    }

    const session = await db.auditSession.findFirst({
      where: { id: auditSessionId, organizationId },
      select: { id: true },
    });
    if (!session) {
      return data(
        { error: { message: "Audit session not found" } },
        { status: 404 }
      );
    }

    // Shared pipeline: parse multipart, resize, thumbnail, upload to
    // storage, create the AuditImage row tied to auditAssetId.
    const image = await uploadAuditImage({
      request,
      auditSessionId,
      organizationId,
      uploadedById: user.id,
      auditAssetId,
    });

    // Mirror the webapp: record the upload as a note so it shows in the
    // activity feed and the audit PDF report (pdf-helpers reads auditNote
    // + auditImage by auditAssetId).
    await db.$transaction(async (tx) => {
      if (content?.trim()) {
        await tx.auditNote.create({
          data: {
            auditSessionId,
            auditAssetId,
            userId: user.id,
            content: `${content.trim()}\n\n{% audit_images count=1 ids="${
              image.id
            }" /%}`,
            type: "COMMENT",
          },
        });
      } else {
        await createAuditAssetImagesAddedNote({
          auditSessionId,
          auditAssetId,
          userId: user.id,
          imageIds: [image.id],
          tx,
        });
      }
    });

    return data({ image });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
