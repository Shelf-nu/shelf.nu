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

export const meta = () => [{ title: appendToMetaTitle("Duplicate audit") }];

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

export default function DuplicateAudit() {
  return <DuplicateAuditDialog />;
}
