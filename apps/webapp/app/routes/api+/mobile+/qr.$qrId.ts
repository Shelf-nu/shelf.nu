import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  MOBILE_ASSET_SELECT,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/qr/:qrId
 *
 * Resolves a QR code to its linked asset or kit.
 * Used by the mobile scanner after scanning a Shelf QR code.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const { qrId } = getParams(params, z.object({ qrId: z.string() }));

    // First fetch just the QR code to check authorization
    const qr = await db.qr.findUnique({
      where: { id: qrId },
      select: {
        id: true,
        assetId: true,
        kitId: true,
        organizationId: true,
      },
    });

    if (!qr) {
      return data({ error: { message: "QR code not found" } }, { status: 404 });
    }

    // Require organization membership — deny unowned QR codes
    if (!qr.organizationId) {
      return data(
        {
          error: { message: "This QR code is not linked to any organization" },
        },
        { status: 404 }
      );
    }

    const membership = await db.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: qr.organizationId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      return data(
        {
          error: {
            message: "This QR code belongs to a different organization",
          },
        },
        { status: 403 }
      );
    }

    // Now fetch the full data (only after authorization passes)
    let asset = null;
    if (qr.assetId) {
      asset = await db.asset.findUnique({
        where: { id: qr.assetId },
        select: MOBILE_ASSET_SELECT,
      });
    }

    return data({
      qr: {
        id: qr.id,
        assetId: qr.assetId,
        kitId: qr.kitId,
        organizationId: qr.organizationId,
        asset,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
