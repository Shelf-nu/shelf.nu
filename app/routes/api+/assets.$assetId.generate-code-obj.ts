import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
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
    const { organizationId, userOrganizations } = await requirePermission({
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

    return json(
      data({
        qrObj,
        barcodes: asset.barcodes,
        sequentialId: asset.sequentialId,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return json(error(reason), { status: reason.status });
  }
}
