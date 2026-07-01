/**
 * Mobile scanned-code resolver (shared)
 *
 * Resolves a scanned QR id or SAM / sequential id to its linked asset or kit,
 * enforcing organization membership. It deliberately does NOT record scan
 * provenance: recording is the *caller's* (the endpoint's) decision.
 *
 * This is the seam that keeps the recording vs non-recording behaviour an
 * endpoint-level choice instead of a client-supplied flag, mirroring the web,
 * which has two distinct routes over the same resolution:
 *   - `qr+/_public+/$qrId.tsx`  — records a scan (a real field scan)
 *   - `api+/get-scanned-item.$qrId` — identify only, never records
 *
 * Mobile mirrors that with two routes that both call this resolver:
 *   - `api+/mobile+/qr.$qrId.ts`            — records (scanner tab, deep links)
 *   - `api+/mobile+/get-scanned-item.$qrId` — identify only (audit scanner)
 *
 * @see {@link file://./../../routes/api+/mobile+/qr.$qrId.ts}
 * @see {@link file://./../../routes/api+/mobile+/get-scanned-item.$qrId.ts}
 */

import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireOrganizationAccess,
  MOBILE_ASSET_SELECT,
  MOBILE_KIT_SELECT,
  shapeMobileAssetResponse,
  shapeMobileKitResponse,
} from "~/modules/api/mobile-auth.server";
import { getParams } from "~/utils/http.server";
import { parseSequentialId } from "~/utils/sequential-id";

/** The resolved code payload returned to the companion (shared by both routes). */
type ResolvedCode = {
  /** Stable code id: the QR id, or the SAM id when there is no backing QR. */
  id: string;
  assetId: string | null;
  kitId: string | null;
  organizationId: string;
  asset: unknown;
  kit: unknown;
};

/**
 * Discriminated result of {@link resolveMobileScannedCode}.
 *
 * On success, `recordableQrId` is the QR id a recording caller may attribute a
 * scan to, or `null` for a SAM resolve (no backing QR record, so nothing to
 * record, matching the web).
 */
export type ResolveMobileCodeResult =
  | { ok: false; status: number; message: string }
  | { ok: true; qr: ResolvedCode; recordableQrId: string | null };

/**
 * Resolve a scanned code to its asset/kit, enforcing org membership.
 *
 * @param args.request - The loader request (for SAM org context).
 * @param args.params - The route params (carries `qrId`).
 * @param args.user - The authenticated caller (`requireMobileAuth` result).
 * @returns A {@link ResolveMobileCodeResult}. Never throws for the expected
 *   not-found / wrong-org cases; those come back as `{ ok: false }`.
 */
export async function resolveMobileScannedCode({
  request,
  params,
  user,
}: {
  request: LoaderFunctionArgs["request"];
  params: LoaderFunctionArgs["params"];
  user: { id: string };
}): Promise<ResolveMobileCodeResult> {
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  // ── SAM / sequential ID path (web parity) ──
  // SAM ids are unique per-org (not global like a QR id), so resolution needs
  // the caller's workspace. Core identifier, NOT gated behind the Barcodes
  // add-on (matches web, where SAM resolution sits in the qr-read path).
  const sequentialId = parseSequentialId(qrId);
  if (sequentialId) {
    const organizationId = await requireOrganizationAccess(request, user.id);
    const asset = await db.asset.findFirst({
      where: { organizationId, sequentialId },
      select: MOBILE_ASSET_SELECT,
    });

    if (!asset) {
      return {
        ok: false,
        status: 404,
        message:
          "This SAM ID doesn't exist or it doesn't belong to your current organization.",
      };
    }

    return {
      ok: true,
      // No backing QR record, so nothing to record a scan against.
      recordableQrId: null,
      qr: {
        id: sequentialId,
        assetId: asset.id,
        kitId: null,
        organizationId,
        // Flatten the new pivot shape (assetKits/assetLocations/custody) into
        // the legacy flat shape the companion expects (quantities restructure).
        asset: shapeMobileAssetResponse(asset),
        kit: null,
      },
    };
  }

  // First fetch just the QR code to check authorization.
  const qr = await db.qr.findUnique({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: mobile QR scan resolves code->org before any org context exists; org membership is enforced immediately below before any linked data is returned
    where: { id: qrId },
    select: { id: true, assetId: true, kitId: true, organizationId: true },
  });

  if (!qr) {
    return { ok: false, status: 404, message: "QR code not found" };
  }

  // Require organization membership — deny unowned QR codes.
  if (!qr.organizationId) {
    return {
      ok: false,
      status: 404,
      message: "This QR code is not linked to any organization",
    };
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
    return {
      ok: false,
      status: 403,
      message: "This QR code belongs to a different organization",
    };
  }

  // Now fetch the full data (only after authorization passes), scoped to
  // qr.organizationId (proven above: non-null and the caller is a member).
  // Use ternaries so Prisma's result type flows to the shape helpers.
  const asset = qr.assetId
    ? await db.asset.findFirst({
        where: { id: qr.assetId, organizationId: qr.organizationId },
        select: MOBILE_ASSET_SELECT,
      })
    : null;

  // Kit-linked QR: return the kit so the scanner can batch-operate on it
  // (web parity — all web scanner drawers accept kits).
  const kit =
    !qr.assetId && qr.kitId
      ? await db.kit.findFirst({
          where: { id: qr.kitId, organizationId: qr.organizationId },
          select: MOBILE_KIT_SELECT,
        })
      : null;

  return {
    ok: true,
    recordableQrId: qr.id,
    qr: {
      id: qr.id,
      assetId: qr.assetId,
      kitId: qr.kitId,
      organizationId: qr.organizationId,
      // Flatten the new pivot shape (assetKits/assetLocations/custody) into the
      // legacy flat shape the companion expects (quantities restructure).
      asset: asset ? shapeMobileAssetResponse(asset) : null,
      kit: shapeMobileKitResponse(kit),
    },
  };
}
