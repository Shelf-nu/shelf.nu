import type { Prisma } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * This API find all/some assets in current organization and returns the required data
 * for generating qr codes after validation.
 */
export async function loader({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const assetIds = searchParams.getAll("assetIds");

    if (assetIds.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        message: "No asset id provided.",
        shouldBeCaptured: false,
        label: "Assets",
      });
    }

    /* If we are selecting all assets in list then we have to consider other filters  */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({
          organizationId,
          currentSearchParams: searchParams.toString(),
        })
      : { id: { in: assetIds }, organizationId };

    const assets = await db.asset.findMany({
      where,
      select: { id: true, title: true, createdAt: true },
    });

    const assetsWithQrObj = [];

    for (const asset of assets) {
      const qrObj = await generateQrObj({
        assetId: asset.id,
        organizationId,
        userId,
      });

      assetsWithQrObj.push({
        ...asset,
        qr: qrObj.qr,
      });
    }

    return json(data({ assets: assetsWithQrObj }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
