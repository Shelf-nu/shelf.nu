import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { mobileBulkIdsSchema } from "~/modules/api/mobile-bulk-ids.server";
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bulk-assign-custody
 *
 * Assigns custody of multiple assets to a team member.
 * Uses the same `bulkCheckOutAssets` service as the webapp to ensure
 * consistent behavior (status updates, notes, validation).
 *
 * Body: { assetIds: string[], custodianId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // RBAC: require asset:custody permission
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    // safeParse, not parse: a raw ZodError reaches `makeShelfError`'s
    // unknown branch and surfaces as a captured 500 "Sorry, something went
    // wrong". A malformed body is a client error, and the select-all
    // rejection below is an EXPECTED one — reporting it as a server outage
    // would bury it in Sentry.
    const parsed = z
      .object({
        assetIds: mobileBulkIdsSchema("assetIds"),
        custodianId: z.string().min(1),
      })
      .safeParse(await request.json().catch(() => null));

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

    const { assetIds, custodianId } = parsed.data;

    // Get user context (role + barcode access) for asset index settings
    const { role, canUseBarcodes, canSeeAllCustody } =
      await getMobileUserContext(user.id, organizationId);

    const settings = await getAssetIndexSettings({
      userId: user.id,
      organizationId,
      canUseBarcodes,
      role,
    });

    // Validate custodian belongs to the organization
    const teamMember = await getTeamMember({
      id: custodianId,
      organizationId,
      select: { id: true, name: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId: user.id, assetIds, custodianId },
        label: "Assets",
        status: 404,
      });
    });

    /**
     * Pass `role` so the service-level SELF_SERVICE guard fires.
     * Without it, a SELF_SERVICE user could assign custody to any
     * team member (hex-security r3202162994).
     */
    const { skippedQuantityTracked } = await bulkCheckOutAssets({
      userId: user.id,
      role,
      assetIds,
      custodianId,
      custodianName: teamMember.name,
      organizationId,
      currentSearchParams: "",
      settings,
      /**
       * Mobile sends no list filters (`currentSearchParams` is empty above), so
       * this never narrows anything today — the where-builder returns before it
       * is read. It still tracks the caller's real visibility so the day mobile
       * starts forwarding filters, a restricted user does not silently gain a
       * custodian filter. Swap in `scopeCustodianFilterIds` at that point, so
       * they can still filter by their OWN custody.
       */
      allowedTeamMemberIds: canSeeAllCustody ? "all" : [],
    });

    // Additive: the service silently skips QUANTITY_TRACKED assets on mixed
    // selections (they need a per-asset quantity — use
    // /api/mobile/custody/assign-quantity). Forward the count so the app can
    // report it honestly, mirroring the web's assets.bulk-assign-custody.ts.
    // An ALL-quantity-tracked selection throws in the service instead and
    // surfaces through the error envelope.
    return data({ success: true, skippedQuantityTracked });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
