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
 *
 * Body: multipart/form-data with:
 *   - `image` (required): the photo file
 *   - `content` (optional): note text to attach alongside the photo. Sent
 *     in the body (not the query) so a long note can't blow URL limits or
 *     leak into request logs.
 *
 * The upload pipeline (resize/thumbnail/storage) is shared with the webapp
 * via `uploadAuditImage`.
 *
 * @param args - Remix action args; `request` carries the bearer auth
 *   header, the query params, and the multipart body (`image` + optional
 *   `content`)
 * @returns A JSON `Response`: `{ image }` on success, otherwise
 *   `{ error: { message } }` with a 4xx status (400/403/404)
 * @throws Never — all failures are caught and returned as JSON error
 *   responses via `makeShelfError`
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

    // Security: the auditAssetId must belong to THIS session (the session
    // is already org-scoped above). Without this a client could attach an
    // image to an AuditAsset from another audit/org — cross-tenant write.
    const auditAsset = await db.auditAsset.findFirst({
      where: { id: auditAssetId, auditSessionId },
      select: { id: true },
    });
    if (!auditAsset) {
      return data(
        { error: { message: "Audit asset not found in this session" } },
        { status: 404 }
      );
    }

    // Read the optional note text from the multipart body, NOT the query
    // string: a note can be up to 5000 chars, which risks URL-length
    // limits (414/413) and leaks potentially-sensitive text into access /
    // CDN logs. Clone so uploadAuditImage can still parse the file stream
    // from the original request (mirrors the webapp sibling).
    const formData = await request.clone().formData();
    const contentRaw = formData.get("content");
    const content = typeof contentRaw === "string" ? contentRaw : null;

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
            // Strip Markdoc delimiters from user content so it can't break
            // or inject the trailing {% audit_images %} tag. (The webapp
            // sibling has the same unsanitized concat — flagged for a
            // shared-helper follow-up rather than diverging silently.)
            content: `${content
              .trim()
              .replace(/\{%|%\}/g, "")}\n\n{% audit_images count=1 ids="${
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
