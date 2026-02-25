import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { getKitsWhereInput } from "~/modules/kit/utils.server";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";

/**
 * Resolves asset IDs for bulk location operations.
 * Handles ALL_SELECTED_KEY expansion using asset filters + locationId.
 */
export async function resolveLocationAssetIds({
  ids,
  organizationId,
  locationId,
  request,
}: {
  ids: string[];
  organizationId: string;
  locationId: string;
  request: Request;
}): Promise<string[]> {
  if (!ids.includes(ALL_SELECTED_KEY)) {
    return ids;
  }

  const searchParams = getCurrentSearchParams(request);
  const assetsWhere = getAssetsWhereInput({
    organizationId,
    currentSearchParams: searchParams.toString(),
  });

  const allAssets = await db.asset.findMany({
    where: {
      ...assetsWhere,
      locationId,
    },
    select: { id: true },
  });

  return allAssets.map((a) => a.id);
}

/**
 * Resolves kit IDs for bulk location operations.
 * Handles ALL_SELECTED_KEY expansion using kit filters + locationId.
 */
export async function resolveLocationKitIds({
  ids,
  organizationId,
  locationId,
  request,
}: {
  ids: string[];
  organizationId: string;
  locationId: string;
  request: Request;
}): Promise<string[]> {
  if (!ids.includes(ALL_SELECTED_KEY)) {
    return ids;
  }

  const searchParams = getCurrentSearchParams(request);
  const kitsWhere = getKitsWhereInput({
    organizationId,
    currentSearchParams: searchParams.toString(),
  });

  const allKits = await db.kit.findMany({
    where: {
      ...kitsWhere,
      locationId,
    },
    select: { id: true },
  });

  return allKits.map((k) => k.id);
}
