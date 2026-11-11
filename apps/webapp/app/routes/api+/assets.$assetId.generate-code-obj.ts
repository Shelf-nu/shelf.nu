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

    // Both lookups are scoped to the caller's workspace: getAsset refuses a
    // asset from another workspace, and so does generateQrObj's own lock.
    const [asset, qrObj] = await Promise.all([
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
      generateQrObj({
        assetId,
        userId,
        organizationId,
      }),
    ]);

    return data(
      payload({
        qrObj,
        barcodes: asset.barcodes,
        sequentialId: asset.sequentialId,
        showShelfBranding: currentOrganization.showShelfBranding,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}
