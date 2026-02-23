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
 * API route to fetch kits by IDs for popover display
 * Used by KitsListComponent to show kit details
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids");

    if (!idsParam) {
      return data(payload({ kits: [] }));
    }

    const kitIds = idsParam.split(",").filter(Boolean);

    if (kitIds.length === 0) {
      return data(payload({ kits: [] }));
    }

    const kits = await db.kit.findMany({
      where: {
        id: { in: kitIds },
        organizationId, // Ensure user can only see kits from their organization
      },
      select: {
        id: true,
        name: true,
        image: true,
        imageExpiration: true,
        assets: {
          select: {
            id: true,
            title: true,
            mainImage: true,
            mainImageExpiration: true,
            category: {
              select: {
                name: true,
              },
            },
          },
          orderBy: {
            title: "asc",
          },
        },
        _count: {
          select: {
            assets: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return data(payload({ kits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
