import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { serializeAssetImage } from "~/modules/asset/image-resolution";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
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
        assetKits: {
          select: {
            asset: {
              select: {
                id: true,
                title: true,
                mainImage: true,
                mainImageExpiration: true,
                thumbnailImage: true,
                // Model cover image for assets with no image of their own
                ...ASSET_MODEL_IMAGE_SELECT,
                category: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { asset: { title: "asc" } },
        },
        _count: {
          select: {
            assetKits: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    /**
     * Resolve each member asset's image cascade server-side so the note's kit
     * popover shows the model's cover image for assets without one of their
     * own. See `serializeAssetImage`.
     */
    return data(
      payload({
        kits: kits.map((kit) => ({
          ...kit,
          assetKits: kit.assetKits.map((assetKit) => ({
            ...assetKit,
            asset: serializeAssetImage(assetKit.asset),
          })),
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
