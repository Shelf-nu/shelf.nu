import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * API route to fetch audit images by IDs for display in completion notes
 * Used by AuditImagesComponent to show image thumbnails with preview
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids");

    if (!idsParam) {
      return data(payload({ images: [] }));
    }

    const imageIds = idsParam.split(",").filter(Boolean);

    if (imageIds.length === 0) {
      return data(payload({ images: [] }));
    }

    const images = await db.auditImage.findMany({
      where: {
        id: { in: imageIds },
        organizationId, // Ensure user can only see images from their organization
      },
      select: {
        id: true,
        imageUrl: true,
        thumbnailUrl: true,
        description: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return data(payload({ images }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
