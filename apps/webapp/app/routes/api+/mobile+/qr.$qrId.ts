import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  MOBILE_ASSET_SELECT,
  MOBILE_KIT_SELECT,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import { parseSequentialId } from "~/utils/sequential-id";

/**
 * GET /api/mobile/qr/:qrId
 *
 * Resolves a scanned code to its linked asset or kit. Handles two id shapes,
 * mirroring the web scan resolver (`api+/get-scanned-item.$qrId`):
 *
 * 1. SAM / sequential ID (e.g. `SAM-0001`) — resolved via `Asset.sequentialId`,
 *    scoped to the caller's workspace. SAM ids are unique PER-ORG (not global
 *    like a QR id), so this branch needs explicit org context via `?orgId=`.
 *    It is a CORE identifier — deliberately NOT gated behind the Barcodes
 *    add-on (matches web, where SAM resolution sits in the qr-read path).
 * 2. QR id — resolved via the `Qr` record, which self-identifies its org.
 *
 * Used by the mobile scanner after scanning/typing a Shelf code.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const { qrId } = getParams(params, z.object({ qrId: z.string() }));

    // ── SAM / sequential ID path (web parity) ──
    const sequentialId = parseSequentialId(qrId);
    if (sequentialId) {
      // SAM is unique per-org, so resolution requires the caller's workspace.
      const organizationId = await requireOrganizationAccess(request, user.id);
      const asset = await db.asset.findFirst({
        where: { organizationId, sequentialId },
        select: MOBILE_ASSET_SELECT,
      });

      if (!asset) {
        return data(
          {
            error: {
              message:
                "This SAM ID doesn't exist or it doesn't belong to your current organization.",
            },
          },
          { status: 404 }
        );
      }

      return data({
        qr: {
          // No backing QR record — surface the SAM id in the id slot so the
          // client has a stable code identifier for dedup/labelling.
          id: sequentialId,
          assetId: asset.id,
          kitId: null,
          organizationId,
          asset,
          kit: null,
        },
      });
    }

    // First fetch just the QR code to check authorization
    const qr = await db.qr.findUnique({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: mobile QR scan resolves code->org before any org context exists; org membership is enforced immediately below (lines 38-66) before any linked data is returned
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

    // Now fetch the full data (only after authorization passes).
    // Scope by qr.organizationId — proven above (line 38 ensures it exists,
    // lines 47-66 verify the caller is a member of that org) — so the linked
    // asset/kit can be safely constrained to the same organization.
    let asset = null;
    if (qr.assetId) {
      asset = await db.asset.findFirst({
        where: { id: qr.assetId, organizationId: qr.organizationId },
        select: MOBILE_ASSET_SELECT,
      });
    }

    // Kit-linked QR: return the kit so the scanner can batch-operate on it
    // (web parity — all web scanner drawers accept kits).
    let kit = null;
    if (!qr.assetId && qr.kitId) {
      kit = await db.kit.findFirst({
        where: { id: qr.kitId, organizationId: qr.organizationId },
        select: MOBILE_KIT_SELECT,
      });
    }

    return data({
      qr: {
        id: qr.id,
        assetId: qr.assetId,
        kitId: qr.kitId,
        organizationId: qr.organizationId,
        asset,
        kit,
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
