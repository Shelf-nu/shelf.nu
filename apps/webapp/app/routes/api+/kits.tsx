import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { queryRaw, sql } from "~/database/sql.server";
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

    const rows = await queryRaw<{
      kitId: string;
      kitName: string;
      kitImage: string | null;
      kitImageExpiration: string | null;
      assetCount: number;
      assetId: string | null;
      assetTitle: string | null;
      assetMainImage: string | null;
      assetMainImageExpiration: string | null;
      categoryName: string | null;
    }>(
      db,
      sql`SELECT
            k."id" AS "kitId",
            k."name" AS "kitName",
            k."image" AS "kitImage",
            k."imageExpiration" AS "kitImageExpiration",
            (SELECT COUNT(*)::int FROM "Asset" WHERE "kitId" = k."id") AS "assetCount",
            a."id" AS "assetId",
            a."title" AS "assetTitle",
            a."mainImage" AS "assetMainImage",
            a."mainImageExpiration" AS "assetMainImageExpiration",
            c."name" AS "categoryName"
          FROM "Kit" k
          LEFT JOIN "Asset" a ON a."kitId" = k."id"
          LEFT JOIN "Category" c ON c."id" = a."categoryId"
          WHERE k."id" = ANY(${kitIds})
            AND k."organizationId" = ${organizationId}
          ORDER BY k."name" ASC, a."title" ASC`
    );

    // Reshape flat rows into nested kit objects
    const kitMap = new Map<
      string,
      {
        id: string;
        name: string;
        image: string | null;
        imageExpiration: string | null;
        assets: Array<{
          id: string;
          title: string;
          mainImage: string | null;
          mainImageExpiration: string | null;
          category: { name: string } | null;
        }>;
        _count: { assets: number };
      }
    >();

    for (const row of rows) {
      if (!kitMap.has(row.kitId)) {
        kitMap.set(row.kitId, {
          id: row.kitId,
          name: row.kitName,
          image: row.kitImage,
          imageExpiration: row.kitImageExpiration,
          assets: [],
          _count: { assets: row.assetCount },
        });
      }
      if (row.assetId) {
        kitMap.get(row.kitId)!.assets.push({
          id: row.assetId,
          title: row.assetTitle!,
          mainImage: row.assetMainImage,
          mainImageExpiration: row.assetMainImageExpiration,
          category: row.categoryName ? { name: row.categoryName } : null,
        });
      }
    }

    const kits = Array.from(kitMap.values());

    return data(payload({ kits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
