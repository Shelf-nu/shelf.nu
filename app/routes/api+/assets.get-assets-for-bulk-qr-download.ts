import type { Prisma } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type BulkQrDownloadLoaderData = {
  assets: Array<{
    id: string;
    title: string;
    sequentialId: string | null;
    createdAt: Date;
    qr: {
      id: string;
      src: string;
      size: "small" | "cable" | "medium" | "large";
    };
  }>;
  qrIdDisplayPreference: string;
  showShelfBranding: boolean;
};

/**
 * This API find all/some assets in current organization and returns the required data
 * for generating qr codes after validation.
 */
export async function loader({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
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
      select: { id: true, title: true, createdAt: true, sequentialId: true },
    });

    if (assets.length > 100) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        message:
          "Bulk downloading QR codes is only available for maximum 100 codes at a time. Please select less codes to download.",
      });
    }

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

    return json(
      payload({
        assets: assetsWithQrObj,
        qrIdDisplayPreference: currentOrganization.qrIdDisplayPreference,
        showShelfBranding: currentOrganization.showShelfBranding,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
