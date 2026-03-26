/**
 * Audit Duplication Route
 *
 * Handles duplicating an audit session into a new PENDING audit.
 * The loader pre-checks asset availability and shows warnings about
 * missing assets. The action performs the actual duplication.
 *
 * Follows the same pattern as bookings.$bookingId.overview.duplicate.tsx.
 *
 * @see {@link file://./../../modules/audit/service.server.ts} duplicateAuditSession
 * @see {@link file://./../../components/audit/duplicate-audit-dialog.tsx}
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { DuplicateAuditDialog } from "~/components/audit/duplicate-audit-dialog";
import { db } from "~/database/db.server";
import type { AuditContextType } from "~/modules/audit/context-helpers.server";
import { resolveAssetIdsForAudit } from "~/modules/audit/context-helpers.server";
import { duplicateAuditSession } from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
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

    // Fetch the audit to show its name and pre-check asset availability
    const audit = await db.auditSession.findFirst({
      where: { id: auditId, organizationId },
      include: {
        assets: { select: { assetId: true } },
      },
    });

    if (!audit) {
      throw new Error("Audit not found.");
    }

    const originalAssetCount = audit.assets.length;

    // Pre-check how many assets still exist
    const scopeMeta =
      typeof audit.scopeMeta === "object" && audit.scopeMeta
        ? (audit.scopeMeta as Record<string, unknown>)
        : null;
    const contextType = scopeMeta?.contextType as string | undefined;

    let availableAssetCount: number;

    if (
      audit.targetId &&
      contextType &&
      ["location", "kit", "user"].includes(contextType)
    ) {
      try {
        const assetIds = await resolveAssetIdsForAudit({
          organizationId,
          contextType: contextType as AuditContextType,
          contextId: audit.targetId,
          contextName: scopeMeta?.contextName as string | undefined,
          includeChildLocations: false,
        });
        availableAssetCount = assetIds.length;
      } catch {
        // Context entity gone — fall back to counting existing assets from records
        const existingAssets = await db.asset.count({
          where: {
            id: { in: audit.assets.map((a) => a.assetId) },
            organizationId,
          },
        });
        availableAssetCount = existingAssets;
      }
    } else {
      const existingAssets = await db.asset.count({
        where: {
          id: { in: audit.assets.map((a) => a.assetId) },
          organizationId,
        },
      });
      availableAssetCount = existingAssets;
    }

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
