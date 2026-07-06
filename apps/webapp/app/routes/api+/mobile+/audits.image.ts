import { data, type ActionFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createAuditImageEvidenceNote } from "~/modules/audit/helpers.server";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { requireAuditAssetInSession } from "~/modules/audit/mobile-evidence.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/audits/image
 *
 * Uploads one condition photo for a scanned asset within an audit and
 * records the matching evidence note, so the image + note reach the audit
 * PDF report exactly like the webapp single-file `upload-image` intent in
 * `routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx`.
 *
 * Query params:
 *   - orgId (required), auditSessionId (required), auditAssetId (required)
 *
 * Body: multipart/form-data with `image` (required) and optional `content`
 * (note text). `content` is read from the SAME bounded parse that streams
 * the file (`uploadAuditImage` -> `parseFileFormData`, `maxFileSize`
 * enforced; `@remix-run/form-data-parser` passes text fields through) —
 * never via an unbounded `request.clone().formData()`.
 *
 * @param args - Remix action args; `request` carries bearer auth, the
 *   query params, and the multipart body
 * @returns JSON `{ image }` on success, else `{ error: { message } }` 4xx
 * @throws Never — failures are caught and returned via `makeShelfError`
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    // Paid Audits add-on gate. #2551 replaced the standalone
    // `requireMobileAuditsEnabled` helper with the `canUseAudits` flag on
    // `getMobileUserContext` — mirror `audits.complete.ts` so the revenue
    // gate stays consistent across every mobile audit route.
    const { canUseAudits } = await getMobileUserContext(
      user.id,
      organizationId
    );
    if (!canUseAudits) {
      return data(
        {
          error: {
            message:
              "Audits are not enabled for this workspace. Contact your admin to enable this feature.",
          },
        },
        { status: 403 }
      );
    }

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

    // Org-scoped session + asset-in-session + assignee scoping (shared with
    // the note route; unit-tested in mobile-evidence.server.test.ts).
    await requireAuditAssetInSession({
      auditSessionId,
      auditAssetId,
      organizationId,
      userId: user.id,
    });

    // Single bounded parse: the file stream AND the optional `content`
    // text field come from `parseFileFormData` (maxFileSize enforced;
    // @remix-run/form-data-parser passes text fields through). No separate
    // `request.clone().formData()` — that buffered the whole upload
    // unbounded before any size check (closed DoS vector).
    const { image, formData } = await uploadAuditImage({
      request,
      auditSessionId,
      organizationId,
      uploadedById: user.id,
      auditAssetId,
      returnParsedFormData: true,
    });

    const contentRaw = formData.get("content");
    // Forward raw content to the helper — sanitization (Markdoc injection
    // stripping) is encapsulated in buildAuditImagesNoteContent inside
    // createAuditImageEvidenceNote (unit-tested in note-content.server.test.ts).
    const content = typeof contentRaw === "string" ? contentRaw : null;

    // Shared, sanitized, transactional evidence-note writer (same helper
    // the webapp scan route uses — Markdoc injection closed there too).
    await db.$transaction(async (tx) => {
      await createAuditImageEvidenceNote({
        tx,
        auditSessionId,
        auditAssetId,
        userId: user.id,
        imageIds: [image.id],
        content,
      });
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
