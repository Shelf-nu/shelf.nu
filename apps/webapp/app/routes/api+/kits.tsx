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
      },
      orderBy: {
        name: "asc",
      },
    });

    /**
     * Kit membership is stored as `AssetKit` pivot rows, but the popover only
     * ever needs the member assets themselves — so the pivot is flattened away
     * here and the wire shape stays a plain `assets` array. Each asset's image
     * cascade is resolved server-side too, so the popover shows the model's
     * cover image for assets without one of their own (`serializeAssetImage`).
     */
    return data(
      payload({
        kits: kits.map(({ assetKits, ...kit }) => ({
          ...kit,
          assets: assetKits.map((assetKit) =>
            serializeAssetImage(assetKit.asset)
          ),
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
