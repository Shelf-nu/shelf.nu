/**
 * Mobile Audit Evidence — Authorization Composer
 *
 * Single guard shared by the mobile companion's audit-evidence routes
 * (`api+/mobile+/audits.note.ts`, `api+/mobile+/audits.image.ts`). Callers
 * have already passed auth + org access + the paid Audits add-on + the
 * `audit:update` permission; this layer adds the resource-scoping that was
 * previously copy-pasted into each route:
 *
 *  1. The audit session must exist **in the caller's organization**.
 *  2. The auditAsset must belong **to that session** (closes cross-tenant
 *     note/image injection — a client that learns a foreign auditAssetId
 *     must not be able to attach evidence to it).
 *  3. BASE / SELF_SERVICE callers must be an assignee of the audit
 *     (mirrors `audits.complete.ts`).
 *
 * Lives outside `service.server.ts` so the audit service does not depend on
 * `~/modules/api/mobile-auth.server` (avoids a module cycle).
 *
 * @see {@link file://./service.server.ts} requireAuditAssignee
 * @see {@link file://./../api/mobile-auth.server.ts} getMobileUserContext
 */
import { db } from "~/database/db.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";
import { ShelfError } from "~/utils/error";

/**
 * Asserts the caller may write evidence to `auditAssetId` within
 * `auditSessionId`. Resolves on success; throws a `ShelfError` (404 for a
 * missing/cross-tenant session or asset, 403 for a non-assignee) otherwise.
 *
 * @param args.auditSessionId - The audit session id from the request
 * @param args.auditAssetId - The scanned AuditAsset id from the request
 * @param args.organizationId - The caller's resolved organization id
 * @param args.userId - The authenticated user id
 * @throws {ShelfError} 404 if session not in org or asset not in session;
 *   403 if a BASE/SELF_SERVICE caller is not an assignee
 */
export async function requireAuditAssetInSession({
  auditSessionId,
  auditAssetId,
  organizationId,
  userId,
}: {
  auditSessionId: string;
  auditAssetId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const session = await db.auditSession.findFirst({
    where: { id: auditSessionId, organizationId },
    select: { id: true },
  });
  if (!session) {
    throw new ShelfError({
      cause: null,
      message: "Audit session not found",
      additionalData: { auditSessionId, organizationId },
      label: "Audit",
      status: 404,
    });
  }

  const auditAsset = await db.auditAsset.findFirst({
    where: { id: auditAssetId, auditSessionId },
    select: { id: true },
  });
  if (!auditAsset) {
    throw new ShelfError({
      cause: null,
      message: "Audit asset not found in this session",
      additionalData: { auditAssetId, auditSessionId },
      label: "Audit",
      status: 404,
    });
  }

  const { role } = await getMobileUserContext(userId, organizationId);
  const isSelfServiceOrBase = role === "SELF_SERVICE" || role === "BASE";
  await requireAuditAssignee({
    auditSessionId,
    organizationId,
    userId,
    isSelfServiceOrBase,
  });
}
