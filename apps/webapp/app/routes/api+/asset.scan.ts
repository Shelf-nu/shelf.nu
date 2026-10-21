import { ScanCodeType, ScanSource } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { ScanCoordinatesSchema } from "~/modules/scan/geolocation.server";
import { recordScan } from "~/modules/scan/service.server";
import type { RecordScanArgs } from "~/modules/scan/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * The code a GPS update is recorded against: the asset's QR code, or its SAM
 * ID when it has no QR (a QR can be unlinked from an asset).
 *
 * @throws {ShelfError} 400 when the asset has neither, so there is no code to
 *   record the update against
 */
function gpsUpdateCodeOf(asset: {
  id: string;
  sequentialId: string | null;
  qrCodes: { id: string }[];
}): Pick<RecordScanArgs, "codeType" | "code" | "qrId"> {
  const qr = asset.qrCodes[0];
  if (qr) {
    return { codeType: ScanCodeType.QR, code: qr.id, qrId: qr.id };
  }
  if (asset.sequentialId) {
    return { codeType: ScanCodeType.SAM_ID, code: asset.sequentialId };
  }
  throw new ShelfError({
    cause: null,
    status: 400,
    shouldBeCaptured: false,
    message:
      "This asset has no QR code or SAM ID to record the GPS update against.",
    additionalData: { assetId: asset.id },
    label: "Scan",
  });
}

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
      z
        .object({
          assetId: z.string(),
          manuallyGenerated: z
            .string()
            .optional()
            .transform((val) => (val === "yes" ? true : false)),
        })
        // The coordinates are written into the asset's note, so they must be
        // real numbers in range, never free text.
        .and(ScanCoordinatesSchema)
    );

    // The detail-page "Update GPS coordinates" action posts here with
    // manuallyGenerated=yes. Archived assets are frozen (issue #382), so block
    // that deliberate update (regular auto scans keep working).
    if (manuallyGenerated) {
      await assertAssetsAreNotArchived({
        assetIds: [assetId],
        organizationId,
        actorUserId: userId,
      });
    }

    const asset = await getAsset({
      id: assetId,
      organizationId,
      include: { qrCodes: true },
    });
    await recordScan({
      ...gpsUpdateCodeOf(asset),
      source: ScanSource.GPS_UPDATE,
      userAgent: request.headers.get("user-agent"),
      userId,
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
