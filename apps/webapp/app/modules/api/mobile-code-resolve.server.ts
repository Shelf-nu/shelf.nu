/**
 * Mobile scanned-code resolver (shared)
 *
 * Resolves a scanned QR id or SAM / sequential id to its linked asset or kit,
 * enforcing organization membership. A SAM-shaped value the workspace has no
 * asset for falls back to its barcode table, so labels printed with a
 * SAM-shaped barcode value still resolve. It deliberately does NOT record scan
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
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { getParams } from "~/utils/http.server";
import { parseSequentialId } from "~/utils/sequential-id";
import { canUseBarcodes } from "~/utils/subscription.server";

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
 * Structured discriminator for actionable not-ok resolves.
 *
 * `"unclaimed"` — the QR row exists, has no `organizationId` (a printed
 * Shelf code nobody claimed yet) AND is not linked to an asset or kit. The
 * companion uses this to offer the native claim → link flow instead of
 * string-matching the 404 message. Orgless-but-linked rows (a corrupted
 * state `createAsset`'s loose QR-connect branch can produce) deliberately
 * carry NO reason: the web claim loader refuses them (`assetId: null,
 * kitId: null` guard), so the companion must not offer claim either.
 * Additive: the status/message of the not-ok result are unchanged, so
 * existing consumers (audit scanner included) keep behaving exactly as
 * before.
 */
type ResolveMobileCodeFailureReason = "unclaimed";

/**
 * Discriminated result of {@link resolveMobileScannedCode}.
 *
 * On success, `recordableQrId` is the QR id a recording caller may attribute a
 * scan to, or `null` for a SAM resolve (no backing QR record, so nothing to
 * record, matching the web).
 *
 * On failure, `reason`/`qrId` are only present for actionable cases (see
 * {@link ResolveMobileCodeFailureReason}); plain not-found / wrong-org
 * failures carry the message alone.
 */
export type ResolveMobileCodeResult =
  | {
      ok: false;
      status: number;
      message: string;
      /** Structured failure discriminator — present only when actionable. */
      reason?: ResolveMobileCodeFailureReason;
      /** The scanned QR id, echoed back when `reason` is set. */
      qrId?: string;
    }
  | { ok: true; qr: ResolvedCode; recordableQrId: string | null };

/**
 * A barcode row carrying just what a mobile resolve needs.
 *
 * The relation types are borrowed from the shape helpers rather than declared
 * again, so widening `MOBILE_ASSET_SELECT` / `MOBILE_KIT_SELECT` cannot leave
 * this type behind. `getBarcodeByValue` is generic over its `include` and
 * returns `any`, so annotating the call site is what keeps the payload typed.
 */
type MobileBarcodeMatch = {
  value: string;
  assetId: string | null;
  kitId: string | null;
  asset: Parameters<typeof shapeMobileAssetResponse>[0] | null;
  kit: Parameters<typeof shapeMobileKitResponse>[0];
};

/**
 * Resolve a SAM-shaped scan against the workspace's barcode table.
 *
 * Reserved for values the SAM lookup already missed — a SAM id is the core
 * identifier and always wins, so a value that is both resolves as the SAM.
 *
 * Gated on the Barcodes add-on because the barcode table is add-on data:
 * resolving through it for a workspace without the add-on would hand out what
 * the add-on sells. Uses `canUseBarcodes` rather than reading `barcodesEnabled`
 * directly so a self-hosted deployment — which has no billing to gate on and
 * therefore holds every add-on — is not refused; the mobile barcode route
 * gates the same way.
 *
 * Scoped to the caller's own workspace only. The mobile barcode route also
 * searches sibling workspaces so it can offer a switch, but a SAM-shaped value
 * arrives here as a SAM candidate, and SAM resolution never leaves the current
 * workspace.
 *
 * @param args.value - The raw scanned string, exactly as the route received it.
 * @param args.organizationId - The caller's current workspace.
 * @returns An ok result when the value is a barcode LINKED to an asset or kit,
 *   otherwise `null` so the caller can fall through to its own not-found. An
 *   unlinked barcode returns `null` too: the response must not reveal that a
 *   row exists for a code that resolves to nothing.
 * @see {@link file://./../../routes/api+/mobile+/barcode.$value.ts}
 */
async function resolveSamShapedBarcode({
  value,
  organizationId,
}: {
  value: string;
  organizationId: string;
}): Promise<ResolveMobileCodeResult | null> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { barcodesEnabled: true },
  });

  if (!organization || !canUseBarcodes(organization)) {
    return null;
  }

  const barcode: MobileBarcodeMatch | null = await getBarcodeByValue({
    value,
    organizationId,
    include: {
      asset: { select: MOBILE_ASSET_SELECT },
      kit: { select: MOBILE_KIT_SELECT },
    },
  });

  if (!barcode || (!barcode.assetId && !barcode.kitId)) {
    return null;
  }

  return {
    ok: true,
    // A barcode has no QR record, so there is nothing to record a scan
    // against — same as a SAM resolve.
    recordableQrId: null,
    qr: {
      // The stored barcode value, which may differ in case from what was
      // scanned; the companion echoes this id back on follow-up calls.
      id: barcode.value,
      assetId: barcode.assetId,
      kitId: barcode.kitId,
      organizationId,
      // Flatten the pivot shape (assetKits/assetLocations/custody) into the
      // legacy flat shape the companion expects, exactly as the QR path does.
      asset: barcode.asset ? shapeMobileAssetResponse(barcode.asset) : null,
      kit: shapeMobileKitResponse(barcode.kit),
    },
  };
}

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
  // the caller's workspace. The SAM lookup is a core identifier and NOT gated
  // behind the Barcodes add-on (matches web, where SAM resolution sits in the
  // qr-read path); only the barcode fallback below carries that gate.
  const sequentialId = parseSequentialId(qrId);
  if (sequentialId) {
    const organizationId = await requireOrganizationAccess(request, user.id);
    const asset = await db.asset.findFirst({
      where: { organizationId, sequentialId },
      select: MOBILE_ASSET_SELECT,
    });

    if (!asset) {
      // A printed label can carry a SAM-shaped value that the workspace
      // registered as a BARCODE rather than as the asset's SAM id. The
      // companion cannot tell the two apart from the decoded string, so it
      // routes every SAM-shaped scan here; without this fallback such a label
      // dead-ends on the 404 below even though the workspace holds the code.
      const fromBarcode = await resolveSamShapedBarcode({
        // The raw scanned string, not the normalized SAM id: barcode values
        // are matched original-case first, then uppercased.
        value: qrId,
        organizationId,
      });

      if (fromBarcode) {
        return fromBarcode;
      }

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
    // Only a truly unclaimed AND unlinked code is claimable — the web claim
    // loader enforces `assetId: null, kitId: null`, so an orgless-but-linked
    // row (corrupted state) must not advertise the claim flow. It falls back
    // to the plain 404 (companion dead-ends, matching web's refusal).
    const claimable = !qr.assetId && !qr.kitId;
    return {
      ok: false,
      status: 404,
      message: "This QR code is not linked to any organization",
      // Structured discriminator so the companion can take over the native
      // claim → link flow (mirroring web's `/qr/:qrId/claim`) without
      // string-matching the message. Status + message stay unchanged so the
      // audit scanner and older app builds see the exact same 404.
      ...(claimable ? { reason: "unclaimed" as const, qrId: qr.id } : {}),
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
