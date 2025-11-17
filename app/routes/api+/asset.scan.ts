import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { createScan } from "~/modules/scan/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export function loader() {
  return null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { assetId, latitude, longitude, manuallyGenerated } = parseData(
      await request.formData(),
      z.object({
        assetId: z.string(),
        latitude: z.string(),
        longitude: z.string(),
        manuallyGenerated: z
          .string()
          .optional()
          .transform((val) => (val === "yes" ? true : false)),
      })
    );

    const asset = await getAsset({
      id: assetId,
      organizationId,
      include: { qrCodes: true },
    });
    /** WE get the first qrCode as the app only supports 1 code per asset for now */
    const qr = asset?.qrCodes[0];

    await createScan({
      userAgent: request.headers.get("user-agent") as string,
      userId: userId,
      qrId: qr.id,
      deleted: false,
      latitude: latitude,
      longitude: longitude,
      manuallyGenerated,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
