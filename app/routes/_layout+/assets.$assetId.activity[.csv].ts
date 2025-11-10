import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { exportAssetNotesToCsv } from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

function buildFilename(title: string | null | undefined) {
  const fallback = "asset";
  const source = title && title.trim().length > 0 ? title : fallback;
  const sanitizedTitle = source
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const base = sanitizedTitle.length > 0 ? sanitizedTitle : fallback;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  return `${base}-activity-${timestamp}.csv`;
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.note,
      action: PermissionAction.read,
    });

    const asset = await db.asset.findFirstOrThrow({
      where: { id: assetId, organizationId },
      select: { title: true },
    });

    const csv = await exportAssetNotesToCsv({
      request,
      assetId,
      organizationId,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="${buildFilename(
          asset.title
        )}"`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
