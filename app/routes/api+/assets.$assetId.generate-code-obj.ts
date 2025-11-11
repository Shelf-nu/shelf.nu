import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId, ...params },
  });

  try {
    const { organizationId, userOrganizations, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.qr,
        action: PermissionAction.read,
      });

    const [qrObj, asset] = await Promise.all([
      generateQrObj({
        assetId,
        userId,
        organizationId,
      }),
      getAsset({
        id: assetId,
        organizationId,
        userOrganizations,
        request,
        include: {
          barcodes: {
            select: {
              id: true,
              type: true,
              value: true,
            },
          },
        },
      }),
    ]);

    return payload({
      qrObj,
      barcodes: asset.barcodes,
      sequentialId: asset.sequentialId,
      showShelfBranding: currentOrganization.showShelfBranding,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}
