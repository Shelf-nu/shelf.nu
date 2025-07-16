import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getKit } from "~/modules/kit/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    const [qrObj, kit] = await Promise.all([
      generateQrObj({
        kitId,
        userId,
        organizationId,
      }),
      getKit({
        id: kitId,
        organizationId,
        userOrganizations,
        request,
        extraInclude: {
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

    return json(data({ qrObj, barcodes: kit.barcodes }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}
