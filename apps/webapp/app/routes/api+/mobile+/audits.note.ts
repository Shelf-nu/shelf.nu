import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobileAuditsEnabled,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/audits/note
 *
 * Creates a condition note tied to a scanned asset within an audit — the
 * per-asset evidence the audit PDF report renders. Faithfully mirrors the
 * webapp `create-note` intent in
 * `routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx` so the
 * note reaches reports identically.
 *
 * Query params:
 *   - orgId (required): organization ID
 *
 * Body (JSON):
 *   - auditSessionId: string
 *   - auditAssetId: string — the AuditAsset the note is condition evidence for
 *   - content: string — the note body
 *
 * @param args - Remix action args; `request` carries the bearer auth
 *   header, the `orgId` query param, and the JSON body
 * @returns A JSON `Response`: `{ note }` on success, otherwise
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

    const { auditSessionId, auditAssetId, content } = z
      .object({
        auditSessionId: z.string().min(1),
        auditAssetId: z.string().min(1),
        content: z.string().min(1, "Note content is required"),
      })
      .parse(await request.json());

    if (!content.trim()) {
      return data(
        { error: { message: "Note content is required" } },
        { status: 400 }
      );
    }

    // Defense-in-depth: confirm the session is in the caller's org (the
    // webapp scopes this via the route's requirePermission on the param).
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
    // is already org-scoped above). Without this a client could attach a
    // note to an AuditAsset from another audit/org — cross-tenant write.
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

    // Scope to assignment: BASE/SELF_SERVICE hold audit:update, but the
    // mobile list/detail paths restrict them to assigned audits. Mirror
    // audits.complete.ts so a low-privileged user who learns an
    // auditAssetId can't write evidence to an audit they can't access.
    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase = role === "SELF_SERVICE" || role === "BASE";
    await requireAuditAssignee({
      auditSessionId,
      organizationId,
      userId: user.id,
      isSelfServiceOrBase,
    });

    const note = await db.auditNote.create({
      data: {
        content: content.trim(),
        auditSessionId,
        auditAssetId,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });

    return data({ note });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
