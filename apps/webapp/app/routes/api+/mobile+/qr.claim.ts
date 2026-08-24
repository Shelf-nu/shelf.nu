/**
 * Mobile QR Claim API
 *
 * Endpoint backing the companion scanner's native "Unclaimed Code" takeover.
 * Claims an unclaimed Shelf QR code (a printed code with no `organizationId`)
 * into the caller's current organization — the mobile twin of the web claim
 * route (`qr+/_private+/$qrId_.claim.tsx`). It reuses the exact same service
 * function (`claimQrCode`), so claim semantics (unclaimed-only check, 403 on
 * already-claimed, org + user assignment) and any notes/events stay in parity
 * with web for free.
 *
 * Permission gate: `qr` / `update` — Role2PermissionMap only grants BASE and
 * SELF_SERVICE `qr:read`, and ADMIN/OWNER short-circuit to allow-all in
 * `hasPermission`, so this is effectively ADMIN/OWNER only, exactly like the
 * web claim route's `requirePermission` gate.
 *
 * @see {@link file://./../../qr+/_private+/$qrId_.claim.tsx} — the mirrored web route
 * @see {@link file://./../../../modules/qr/service.server.ts} — claimQrCode
 * @see {@link file://./qr.link-asset.ts} — the follow-up link-existing step
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/** Zod schema for the claim JSON body. */
const ClaimQrSchema = z.object({
  qrId: z.string().min(1, "QR ID is required"),
});

/**
 * POST /api/mobile/qr/claim
 *
 * Claims an unclaimed QR code into the caller's current organization.
 *
 * Body: `{ qrId: string }`
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ qr: { id, organizationId, assetId, kitId } }` — the
 * claimed code summary (assetId/kitId are null for a freshly claimed code),
 * so the app can proceed straight to create-new / link-existing.
 *
 * @param args - React Router action args (carrying the incoming request).
 * @returns A JSON response with the claimed QR summary on success, or
 *   `{ error: { message } }` with an appropriate HTTP status on failure:
 *   - 400 Invalid body (including a non-JSON/empty body)
 *   - 401 Missing/invalid bearer token
 *   - 403 Caller lacks `qr:update` (non-admin/owner), the code is already
 *     claimed by an organization (surfaced by `claimQrCode`), or the code is
 *     linked to an asset/kit and therefore not available for claiming
 *     (mirrors the web claim loader's `assetId: null, kitId: null` guard)
 *   - 404 QR code not found
 */
export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Same effective gate as the web claim route: qr/update is admin+owner
    // only (see file-level JSDoc).
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });

    // Claiming is irreversible on a shared physical label — per-user write
    // bucket (generous enough for a full label sheet, unlike "bulk").
    await enforceUserRateLimit(user.id, "write");

    // why: raw `.parse` surfaces a ZodError as a 500 through makeShelfError's
    // unknown-error branch, and `request.json()` itself throws a SyntaxError
    // (also a 500) on a non-JSON/empty body — `.catch(() => null)` funnels
    // that into the same 400, since safeParse(null) fails cleanly.
    const parsed = ClaimQrSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ShelfError({
        cause: parsed.error,
        message: "Invalid request body",
        additionalData: { validationErrors: parsed.error.flatten() },
        label: "QR",
        status: 400,
      });
    }
    const { qrId } = parsed.data;

    // Mirror the web claim loader's guard: only a code with NO asset/kit link
    // is available for claiming (`assetId: null, kitId: null` in
    // $qrId_.claim.tsx). `claimQrCode` only checks `organizationId`, so an
    // orgless-but-linked row (corrupted state) would otherwise be claimable
    // here while web refuses it.
    const existingQr = await db.qr.findUnique({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: an unclaimed code has no organizationId to scope by; this read only gates claimability (linked / missing) and `claimQrCode` re-checks the claimed state before writing
      where: { id: qrId },
      select: { id: true, assetId: true, kitId: true },
    });

    if (!existingQr) {
      throw new ShelfError({
        cause: null,
        message: "QR code not found",
        additionalData: { qrId },
        label: "QR",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    if (existingQr.assetId || existingQr.kitId) {
      throw new ShelfError({
        cause: null,
        message: "This QR code is not available for claiming.",
        additionalData: { qrId },
        label: "QR",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Claim into the caller's CURRENT org (never a body-supplied org id) —
    // `requireOrganizationAccess` already proved membership. `claimQrCode`
    // itself rejects codes that already belong to an organization (403).
    const qr = await claimQrCode({
      id: qrId,
      organizationId,
      userId: user.id,
    });

    return data({
      qr: {
        id: qr.id,
        organizationId: qr.organizationId,
        assetId: qr.assetId,
        kitId: qr.kitId,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
