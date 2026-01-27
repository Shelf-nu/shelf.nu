import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { exportLocationNotesToCsv } from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

function buildFilename(name: string | null | undefined) {
  const fallback = "location";
  const source = name && name.trim().length > 0 ? name : fallback;
  const sanitizedName = source
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const base = sanitizedName.length > 0 ? sanitizedName : fallback;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  return `${base}-activity-${timestamp}.csv`;
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.locationNote,
      action: PermissionAction.read,
    });

    const location = await db.location.findFirstOrThrow({
      where: { id: locationId, organizationId },
      select: { name: true },
    });

    const csv = await exportLocationNotesToCsv({
      request,
      locationId,
      organizationId,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="${buildFilename(
          location.name
        )}"`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
