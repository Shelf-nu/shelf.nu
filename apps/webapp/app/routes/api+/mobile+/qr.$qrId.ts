import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  MOBILE_ASSET_SELECT,
  MOBILE_KIT_SELECT,
} from "~/modules/api/mobile-auth.server";
import { createScan } from "~/modules/scan/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { parseSequentialId } from "~/utils/sequential-id";

/**
 * GET /api/mobile/qr/:qrId
 *
 * Resolves a scanned code to its linked asset or kit. Handles two id shapes,
 * mirroring the web scan resolver (`api+/get-scanned-item.$qrId`):
 *
 * 1. SAM / sequential ID (e.g. `SAM-0001`), resolved via `Asset.sequentialId`,
 *    scoped to the caller's workspace. SAM ids are unique PER-ORG (not global
 *    like a QR id), so this branch needs explicit org context via `?orgId=`.
 *    It is a CORE identifier, deliberately NOT gated behind the Barcodes
 *    add-on (matches web, where SAM resolution sits in the qr-read path).
 * 2. QR id, resolved via the `Qr` record, which self-identifies its org.
 *
 * Used by the mobile scanner after scanning/typing a Shelf code.
 *
 * Recording: for a real QR field scan this also records scan provenance
 * (who + when) via `createScan`, mirroring the public web QR resolver
 * (`qr+/_public+/$qrId.tsx`). Callers that only need to identify a code pass
 * `?recordScan=false` to skip it, mirroring the web split where the public QR
 * route records but the in-app `get-scanned-item` resolve does not. The audit
 * scanner uses this so audit scans never pollute an asset's "last scanned"
 * history (it records its own `AuditScan` separately). SAM resolves never
 * record (no backing QR id, matching web). GPS coordinates are intentionally
 * NOT captured here (a separate, deliberate item).
 *
 * @see {@link file://./../../qr+/_public+/$qrId.tsx} (recording web resolve)
 * @see {@link file://./../get-scanned-item.$qrId} (non-recording web resolve)
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

    // Record scan provenance (who + when) for a real field scan, mirroring the
    // public web QR resolver. Skipped when the caller opts out via
    // `?recordScan=false` (the audit scanner, which records its own AuditScan
    // and must not add ad-hoc scans to an asset's timeline, matching the web
    // where audits resolve through the non-recording `get-scanned-item`). Org
    // membership is verified above, so this only ever logs in-org scans.
    // Non-fatal: a provenance failure must never turn a successful resolve into
    // an error response for the scanner.
    const recordScan =
      new URL(request.url).searchParams.get("recordScan") !== "false";
    if (recordScan) {
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
    }

    // Now fetch the full data (only after authorization passes).
    // Scope by qr.organizationId (proven above: it is verified non-null and the
    // caller is a member of that org) so the linked asset/kit is constrained to
    // the same organization.
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
