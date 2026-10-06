/**
 * POST /api/mobile/custody/assign-quantity
 *
 * Assigns (checks out) N units of a QUANTITY_TRACKED asset to a team member.
 * Mobile twin of the web's `/api/assets/assign-quantity-custody` route: same
 * Zod schema, same org-scoped custodian check, same custody-scope guard, and the
 * same `assignQuantityToCustodian` call (the custody change, its audit note
 * and the low-stock check). Only the auth/permission/envelope skeleton differs
 * (bearer auth + the mobile error envelope, per `custody.assign.ts`).
 *
 * Body: { assetId: string, teamMemberId: string, quantity: number, note?: string }
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ success: true, asset }` where `asset` is the
 * refreshed asset shaped for mobile (custody visibility already filtered
 * for the caller) so the app can update state without a second round trip.
 *
 * @see {@link file://./../assets.assign-quantity-custody.ts} — the mirrored web route
 * @see {@link file://./../../../modules/custody/quantity-custody.server.ts} assignQuantityToCustodian
 * @see {@link file://./custody.release-quantity.ts} — counterpart release route
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileAssetForViewer,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  assignQuantityToCustodian,
  QUANTITY_CUSTODIAN_SELECT,
} from "~/modules/custody/quantity-custody.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * Zod schema for the assign-quantity-custody JSON body. Identical to the
 * web's `AssignQuantityCustodySchema` (assets.assign-quantity-custody.ts).
 */
const AssignQuantityCustodySchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  teamMemberId: z.string().min(1, "Team member is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
  note: z
    .string()
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
});

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    // Same limiter bucket as the other mobile custody mutations — a stuck
    // retry loop or rapid taps shouldn't hammer a row-locking transaction.
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // RBAC: require asset:custody permission (SELF_SERVICE passes, BASE 403s
    // — same Role2PermissionMap as the web quantity routes)
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    // Access for the custody-scope guard below and for shaping the
    // refreshed asset. No getAssetIndexSettings here: checkOutQuantity
    // takes no `settings` param (that call is bulk-route plumbing only).
    const { access } = await getMobileUserContext(user.id, organizationId);

    // why: siblings use raw `.parse`, which surfaces a ZodError as a 500
    // through makeShelfError's unknown-error branch. The web route returns
    // 400 via parseData — safeParse + a 400 ShelfError honors that parity.
    // An unreadable body parses as `null` and fails the schema too, so it
    // takes the same 400 instead of throwing a SyntaxError into the 500 branch.
    const parsed = AssignQuantityCustodySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ShelfError({
        cause: parsed.error,
        message: "Invalid request body",
        additionalData: { validationErrors: parsed.error.flatten() },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }
    const { assetId, teamMemberId, quantity, note } = parsed.data;

    /** Validate that the team member belongs to the same organization */
    const teamMember = await getTeamMember({
      id: teamMemberId,
      organizationId,
      select: { ...QUANTITY_CUSTODIAN_SELECT, userId: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId: user.id, assetId, teamMemberId },
        label: "Assets",
        status: 404,
      });
    });

    /** A caller whose custody scope is `self` may assign only to themselves */
    if (access.custody.assign === "self" && teamMember.userId !== user.id) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self-service users can only assign custody to themselves.",
        additionalData: { userId: user.id, assetId, teamMemberId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // `assignQuantityToCustodian` writes the custody change (validated under
    // a row lock by `checkOutQuantity`), then the audit note and the low-stock
    // check, both best-effort because the change has already committed.
    await assignQuantityToCustodian({
      assetId,
      custodian: teamMember,
      quantity,
      userId: user.id,
      organizationId,
      custodyAssign: access.custody.assign,
      note,
    });

    // No route-level sendNotification success toast here: that's the web's
    // SSE emitter and mobile has no listener (matches custody.assign.ts).

    // Everything past the custody change is best-effort: it has already
    // committed, so a failure must NOT surface as an action error (the client
    // would show a failure, and could retry a non-idempotent assign).

    // Refreshed asset, shaped for mobile with the caller's custody
    // visibility already applied, so the app can update state directly.
    // Null on failure — the app refetches the detail regardless.
    let asset = null;
    try {
      asset = await getMobileAssetForViewer({
        assetId,
        organizationId,
        viewerUserId: user.id,
        canSeeAllCustody: access.custody.seeAll,
      });
    } catch (refreshError) {
      Logger.error(
        new ShelfError({
          cause: refreshError,
          message: "Failed to refresh asset after quantity checkout",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    return data({ success: true, asset });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
