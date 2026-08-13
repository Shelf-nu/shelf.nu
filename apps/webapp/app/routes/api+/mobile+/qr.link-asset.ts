/**
 * Mobile QR Link-Existing-Asset API
 *
 * Endpoint backing the companion's "Link Existing Asset" step. Delegates to
 * `relinkAssetQrCode` — the SAME service the web asset-detail relink action
 * uses — so guard semantics, the audit note, and inline claiming stay in
 * parity with web by construction (CTO review on PR #2753: prefer the
 * guarded shared service over re-implemented route guards).
 *
 * The service enforces: QR exists (404), belongs to the caller's org or is
 * unclaimed (403 otherwise), is not linked to a kit or another asset (403),
 * and writes the "changed QR code" system note on the asset. An UNCLAIMED
 * code is claimed inline into the caller's org as part of the link — the
 * companion no longer needs a separate claim step for the link flow.
 *
 * Permission gate: `qr` / `update` — Role2PermissionMap only grants BASE and
 * SELF_SERVICE `qr:read`, and ADMIN/OWNER short-circuit to allow-all in
 * `hasPermission`, so this is effectively ADMIN/OWNER only, exactly like web.
 *
 * Security notes:
 * - `assetId` comes from the request body (attacker-controlled) and is
 *   asserted to belong to the caller's organization via
 *   `assertAssetsBelongToOrg` before any write (org-scope-user-supplied-ids).
 * - Claim/link is rate-limited per user (`write` bucket): the operation is
 *   irreversible, but a label sheet's worth of scans must fit comfortably.
 *
 * @see {@link file://./../../../modules/asset/service.server.ts} — relinkAssetQrCode
 * @see {@link file://./qr.claim.ts} — the standalone claim step (create flow)
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { relinkAssetQrCode } from "~/modules/asset/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/** Zod schema for the link-existing-asset JSON body. */
const LinkQrAssetSchema = z.object({
  qrId: z.string().min(1, "QR ID is required"),
  assetId: z.string().min(1, "Asset ID is required"),
});

/**
 * POST /api/mobile/qr/link-asset
 *
 * Links a QR code to an existing asset in the caller's current organization.
 * The asset's previous QR codes are disconnected by the service (web parity:
 * linking replaces the asset's code), a system note records the change, and
 * an unclaimed code is claimed into the caller's org inline.
 *
 * Body: `{ qrId: string, assetId: string }`
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ qr: { id, organizationId, assetId, kitId } }` — the
 * linked code summary, so the app can navigate straight to the asset detail.
 *
 * @param args - React Router action args (carrying the incoming request).
 * @returns A JSON response with the linked QR summary on success, or
 *   `{ error: { message } }` with an appropriate HTTP status:
 *   - 400 Invalid body (including a non-JSON/empty body) / asset not found
 *     in the caller's workspace
 *   - 401 Missing/invalid bearer token
 *   - 403 Caller lacks `qr:update` (non-admin/owner), the QR belongs to a
 *     different organization, or it is already linked to another asset/kit
 *   - 404 QR code not found
 *   - 429 Rate limited
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

    // Irreversible write on a shared physical label — per-user write bucket
    // (generous enough for a full label sheet, unlike "bulk"'s 10/min).
    await enforceUserRateLimit(user.id, "write");

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

    // why: assetId is user-supplied — prove it belongs to the caller's org
    // before connecting (org-scope-user-supplied-ids). The service also
    // inline-scopes its writes, but the shared guard gives a clean 400
    // instead of a wrapped Prisma P2025.
    await assertAssetsBelongToOrg({ assetIds: [assetId], organizationId });

    // All QR-state guards (not-found 404, other-org 403, kit-linked /
    // linked-elsewhere 403), the inline claim of unclaimed codes, and the
    // asset's "changed QR code" system note live in the shared service.
    await relinkAssetQrCode({ qrId, assetId, organizationId, userId: user.id });

    return data({
      qr: {
        id: qrId,
        organizationId,
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
