/**
 * Audit Duplication Route
 *
 * Child route that handles duplicating an audit session into a new PENDING
 * audit. The loader pre-checks asset availability so the dialog can render
 * the correct state (clean, warning, or blocking error) before the user
 * submits. The action performs the duplication and redirects to the new
 * audit's overview page.
 *
 * Mirrors `bookings.$bookingId.overview.duplicate.tsx`.
 *
 * @see {@link file://./../../modules/audit/service.server.ts} duplicateAuditSession
 * @see {@link file://./../../components/audit/duplicate-audit-dialog.tsx}
 */
import { AuditStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { DuplicateAuditDialog } from "~/components/audit/duplicate-audit-dialog";
import { db } from "~/database/db.server";
import { duplicateAuditSession } from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ auditId: z.string() });

/**
 * Sets the document title for the duplicate-audit route.
 *
 * @returns React Router meta descriptor with the page title.
 */
export const meta = () => [{ title: appendToMetaTitle("Duplicate audit") }];

/**
 * Loader for the duplicate-audit route.
 *
 * Pre-checks the source audit so the dialog can render the correct state
 * (clean / warning / blocking error) before the user submits. Enforces
 * permission, terminal-status, and existence — counts how many of the
 * original audit's expected assets still exist in the org.
 *
 * @param args - React Router loader args (request, context, params).
 * @returns Payload with the audit name + asset counts for the dialog.
 * @throws {ShelfError} 404 if the audit isn't found, 400 if it's not in a
 *   terminal status, or whatever {@link requirePermission} throws on auth.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    const audit = await db.auditSession.findFirst({
      where: { id: auditId, organizationId },
      include: {
        // Mirror the service: only originally-expected assets count toward
        // the duplicate. Unexpected scans (`expected: false`) are not part
        // of the source's scope.
        assets: { where: { expected: true }, select: { assetId: true } },
      },
    });

    if (!audit) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found.",
        additionalData: { auditId },
        label: "Audit",
        status: 404,
      });
    }

    // Mirror the service-side terminal-status guard so navigating directly
    // to the duplicate route for a PENDING/ACTIVE audit shows a clean error
    // instead of the dialog.
    if (
      audit.status !== AuditStatus.COMPLETED &&
      audit.status !== AuditStatus.CANCELLED &&
      audit.status !== AuditStatus.ARCHIVED
    ) {
      throw new ShelfError({
        cause: null,
        message:
          "Only completed, cancelled, or archived audits can be duplicated.",
        additionalData: { auditId, status: audit.status },
        label: "Audit",
        status: 400,
      });
    }

    const originalAssetCount = audit.assets.length;

    // Count which of the original audit's assets still exist in the org.
    // The action path re-runs the same check inside duplicateAuditSession;
    // this loader query is read-only and exists to populate dialog state.
    const availableAssetCount =
      originalAssetCount === 0
        ? 0
        : await db.asset.count({
            where: {
              id: { in: audit.assets.map((a) => a.assetId) },
              organizationId,
            },
          });

    const droppedAssetCount = originalAssetCount - availableAssetCount;

    return payload({
      showModal: true,
      audit: { id: audit.id, name: audit.name },
      originalAssetCount,
      availableAssetCount,
      droppedAssetCount,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw reason;
  }
}

/**
 * Action for the duplicate-audit route.
 *
 * Performs the duplication via {@link duplicateAuditSession}, fires a
 * success notification, and redirects to the new audit's overview page.
 * Errors are normalised through {@link makeShelfError} and returned as
 * the route's `actionData.error` so the dialog can display them.
 *
 * @param args - React Router action args (request, context, params).
 * @returns Redirect to the new audit on success, or an error payload.
 */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    const { newSession } = await duplicateAuditSession({
      auditSessionId: auditId,
      organizationId,
      userId,
    });

    sendNotification({
      title: "Audit duplicated",
      senderId: userId,
      icon: { name: "success", variant: "success" },
      message: `Audit "${newSession.name}" has been created.`,
    });

    return redirect(`/audits/${newSession.id}/overview`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Default route component — renders the {@link DuplicateAuditDialog}
 * which reads the loader payload and posts to the action on confirm.
 */
export default function DuplicateAudit() {
  return <DuplicateAuditDialog />;
}
