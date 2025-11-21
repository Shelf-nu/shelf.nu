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
 * API route to fetch assets by IDs for popover display
 * Used by AssetsListComponent to show asset details
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids");

    if (!idsParam) {
      return data(payload({ assets: [] }));
    }

    const assetIds = idsParam.split(",").filter(Boolean);

    if (assetIds.length === 0) {
      return data(payload({ assets: [] }));
    }

    const assets = await db.asset.findMany({
      where: {
        id: { in: assetIds },
        organizationId, // Ensure user can only see assets from their organization
      },
      select: {
        id: true,
        title: true,
        mainImage: true,
      },
      orderBy: {
        title: "asc",
      },
    });

    return data(payload({ assets }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
