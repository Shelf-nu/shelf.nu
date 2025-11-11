import { data, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getKit } from "~/modules/kit/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId, userOrganizations, currentOrganization } =
      await requirePermission({
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

    return payload({
      qrObj,
      barcodes: kit.barcodes,
      showShelfBranding: currentOrganization.showShelfBranding,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return data(error(reason), { status: reason.status });
  }
}
