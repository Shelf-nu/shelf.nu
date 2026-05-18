import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  MOBILE_ASSET_SELECT,
} from "~/modules/api/mobile-auth.server";
import { createScan } from "~/modules/scan/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import { Logger } from "~/utils/logger";

/**
 * GET /api/mobile/qr/:qrId
 *
 * Resolves a QR code to its linked asset or kit.
 * Used by the mobile scanner after scanning a Shelf QR code.
 *
 * Also records scan provenance (who + when) via `createScan`, mirroring the
 * public web QR resolver. The companion previously recorded nothing on
 * resolve, so field scans were invisible to an asset's scan history /
 * "last scanned by". GPS coordinates are intentionally NOT captured here —
 * that is a deliberate, separate item (needs a location permission + privacy
 * manifest; see the companion post-launch backlog).
 *
 * @see {@link file://./../../qr+/_public+/$qrId.tsx}
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

    // Record scan provenance (who + when), mirroring the public web QR
    // resolver. Org membership is verified above, so this only ever logs
    // in-org scans — intentionally stricter than web, which also records
    // cross-org "contact owner" scans. Non-fatal: `createScan` throws a
    // ShelfError on failure (e.g. a scan-note write hiccup), and a
    // provenance failure must never turn a successful resolve into an
    // error response for the scanner.
    try {
      await createScan({
        userAgent: request.headers.get("user-agent") ?? "mobile-companion",
        userId: user.id,
        qrId: qr.id,
        deleted: false,
      });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to record mobile scan provenance",
          // why: qrId is enough to trace the failing scan; avoid putting a
          // raw user identifier into the log pipeline.
          additionalData: { qrId: qr.id },
          label: "Scan",
        })
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
