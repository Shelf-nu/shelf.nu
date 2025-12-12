import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { exportAuditNotesToCsv } from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const buildFilename = (name: string | null | undefined) => {
  const fallback = "audit";
  const source = name && name.trim().length > 0 ? name : fallback;
  const sanitizedName = source
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const base = sanitizedName.length > 0 ? sanitizedName : fallback;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  return `${base}-activity-${timestamp}.csv`;
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.auditNote,
      action: PermissionAction.read,
    });

    const audit = await db.auditSession.findFirstOrThrow({
      where: { id: auditId, organizationId },
      select: { name: true },
    });

    const csv = await exportAuditNotesToCsv({
      request,
      auditId,
      organizationId,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="${buildFilename(
          audit.name
        )}"`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
