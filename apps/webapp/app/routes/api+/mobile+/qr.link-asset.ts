/**
 * Mobile QR Link-Existing-Asset API
 *
 * Endpoint backing the companion's "Link Existing Asset" step after a QR code
 * has been claimed (or when scanning a code the caller's org already claimed
 * but never linked). The mobile twin of the web link-existing route
 * (`qr+/_private+/$qrId_.link.asset.tsx`): same permission gate, same QR
 * state guards (claimed by the caller's org, not yet linked to an asset or
 * kit), and the exact same service call (`updateAssetQrCode`) so linking
 * semantics stay in parity with web for free.
 *
 * Permission gate: `qr` / `update` — Role2PermissionMap only grants BASE and
 * SELF_SERVICE `qr:read`, and ADMIN/OWNER short-circuit to allow-all in
 * `hasPermission`, so this is effectively ADMIN/OWNER only, exactly like web.
 *
 * Security notes:
 * - `assetId` comes from the request body (attacker-controlled) and is
 *   asserted to belong to the caller's organization via
 *   `assertAssetsBelongToOrg` before any write (org-scope-user-supplied-ids).
 * - The QR is read unscoped only to distinguish unclaimed / other-org / ours;
 *   ownership is enforced immediately after the read.
 *
 * @see {@link file://./../../qr+/_private+/$qrId_.link.asset.tsx} — the mirrored web route
 * @see {@link file://./../../../modules/asset/service.server.ts} — updateAssetQrCode
 * @see {@link file://./qr.claim.ts} — the preceding claim step
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { updateAssetQrCode } from "~/modules/asset/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/** Zod schema for the link-existing-asset JSON body. */
const LinkQrAssetSchema = z.object({
  qrId: z.string().min(1, "QR ID is required"),
  assetId: z.string().min(1, "Asset ID is required"),
});

/**
 * POST /api/mobile/qr/link-asset
 *
 * Links a claimed-but-unlinked QR code to an existing asset in the caller's
 * current organization. The asset's previous QR codes are disconnected by the
 * service (web parity: linking replaces the asset's code, and the old code
 * can always be re-linked later).
 *
 * Body: `{ qrId: string, assetId: string }`
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ qr: { id, organizationId, assetId, kitId } }` — the
 * linked code summary, so the app can navigate straight to the asset detail.
 *
 * @param args - React Router action args (carrying the incoming request).
 * @returns A JSON response with the linked QR summary on success, or
 *   `{ error: { message, reason? } }` with an appropriate HTTP status:
 *   - 400 Invalid body (including a non-JSON/empty body) / QR not claimed
 *     yet (`reason: "unclaimed"`) / asset not found in the caller's workspace
 *   - 401 Missing/invalid bearer token
 *   - 403 Caller lacks `qr:update` (non-admin/owner), the QR belongs to a
 *     different organization, or it is already linked to an asset or kit
 *   - 404 QR code not found
 */
export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Same effective gate as the web link flow: qr/update is admin+owner
    // only (see file-level JSDoc).
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });

    // why: raw `.parse` surfaces a ZodError as a 500 through makeShelfError's
    // unknown-error branch, and `request.json()` itself throws a SyntaxError
    // (also a 500) on a non-JSON/empty body — `.catch(() => null)` funnels
    // that into the same 400, since safeParse(null) fails cleanly.
    const parsed = LinkQrAssetSchema.safeParse(
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
    const { qrId, assetId } = parsed.data;

    // Mirror the web link routes' state guards ($qrId_.link.tsx loader +
    // $qrId_.link.asset.tsx loader) — mobile has no loader step, so the
    // action enforces them itself before writing anything.
    //
    // Accepted residual: these guards are read-then-write, not atomic —
    // updateAssetQrCode's `connect` is unconstrained on the QR's state, so
    // two concurrent links of the same code both pass and the last write
    // wins (first caller's 200 points at a link that no longer exists).
    // Deliberate: the web action has NO state guards at all (mobile is
    // strictly stronger), the race needs two admins linking the same
    // physical label within milliseconds, and hardening would mean forking
    // the shared service. If it ever bites, fix it in updateAssetQrCode
    // (QR-side atomic update WHERE assetId/kitId null, like claimQrCode)
    // for web AND mobile together — sibling-first.
    const qr = await db.qr.findUnique({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: intentionally unscoped so the route can distinguish three cases — unclaimed code (400 + reason "unclaimed" below), code owned by another org (403 below), and code owned by the caller's org (proceed). Ownership IS enforced immediately below before any write; scoping would collapse the unclaimed case
      where: { id: qrId },
      select: { id: true, organizationId: true, assetId: true, kitId: true },
    });

    if (!qr) {
      throw new ShelfError({
        cause: null,
        message: "QR code not found",
        additionalData: { qrId },
        label: "QR",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    // Unclaimed codes must go through the claim step first (web redirects
    // `/qr/:qrId/link` → `/qr/:qrId/claim` for this case). Returned directly
    // (not thrown) so the structured `reason` reaches the client and the
    // companion can recover by claiming.
    if (!qr.organizationId) {
      return data(
        {
          error: {
            message:
              "This QR code is not claimed yet. Claim it before linking.",
            reason: "unclaimed" as const,
            qrId: qr.id,
          },
        },
        { status: 400 }
      );
    }

    if (qr.organizationId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message: "This QR code doesn't belong to your current organization.",
        additionalData: { qrId, organizationId },
        label: "QR",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (qr.assetId || qr.kitId) {
      throw new ShelfError({
        cause: null,
        message: "This QR code is already linked to an asset or a kit.",
        additionalData: { qrId, organizationId },
        label: "QR",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // why: assetId is user-supplied — prove it belongs to the caller's org
    // before connecting (org-scope-user-supplied-ids). The service also
    // inline-scopes its updates, but the shared guard gives a clean 400
    // instead of a wrapped Prisma P2025.
    await assertAssetsBelongToOrg({ assetIds: [assetId], organizationId });

    await updateAssetQrCode({
      newQrId: qrId,
      assetId,
      organizationId,
    });

    return data({
      qr: {
        id: qr.id,
        organizationId: qr.organizationId,
        assetId,
        kitId: null,
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
