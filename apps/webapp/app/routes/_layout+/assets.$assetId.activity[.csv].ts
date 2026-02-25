import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { exportAssetNotesToCsv } from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { buildContentDisposition, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

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
        "content-disposition": buildContentDisposition(asset.title, {
          fallback: "asset",
          suffix: "-activity",
        }),
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
