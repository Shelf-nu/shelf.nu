import { ScanCodeType, ScanSource } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { recordScan } from "~/modules/scan/service.server";
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
    /** An asset carries one QR code; the GPS update is recorded against it. */
    const qr = asset?.qrCodes[0];

    await recordScan({
      codeType: ScanCodeType.QR,
      code: qr.id,
      source: ScanSource.GPS_UPDATE,
      userAgent: request.headers.get("user-agent"),
      userId,
      qrId: qr.id,
      assetId: asset.id,
      organizationId,
      latitude,
      longitude,
      manuallyGenerated,
      writeNote: true,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
