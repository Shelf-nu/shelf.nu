import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  mobileBulkIdsSchema,
  mobileQuantitiesSchema,
} from "~/modules/api/mobile-bulk-ids.server";
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  assertAssignableQuantities,
  assignQuantities,
  QUANTITY_CUSTODIAN_SELECT,
  splitQuantityAssetIds,
} from "~/modules/custody/quantity-custody.server";
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
 * Body: { assetIds: string[], custodianId: string, quantities?: Record<assetId, units> }
 * Response: { success: true, skippedQuantityTracked, movedQuantityAssetIds, refusedQuantities? }
 *
 * `quantities` comes from the companion's Scan tab, which gives each
 * quantity-tracked row a unit count. An asset named there is assigned unit by
 * unit through the shared quantity-custody functions, exactly as the web
 * scanner's route does, after every named asset has been checked. All other
 * ids take the bulk path. Without `quantities` the route behaves as it always
 * has: quantity-tracked ids are skipped in a mixed list, and a list of only
 * quantity-tracked ids is refused.
 *
 * @see {@link file://./../assets.bulk-assign-custody.ts} the web twin
 * @see {@link file://./../../../modules/custody/quantity-custody.server.ts}
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
        quantities: mobileQuantitiesSchema,
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

    const { assetIds, custodianId, quantities } = parsed.data;
    const { quantityAssetIds, bulkAssetIds } = splitQuantityAssetIds(
      assetIds,
      quantities
    );

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
    // The name fields are what the per-unit audit notes render.
    const teamMember = await getTeamMember({
      id: custodianId,
      organizationId,
      select: QUANTITY_CUSTODIAN_SELECT,
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
    // Every per-unit assignment is checked before anything is written.
    await assertAssignableQuantities({
      quantityAssetIds,
      quantities,
      organizationId,
    });

    /**
     * The whole-asset call runs before the per-unit writes: it validates and
     * writes in one transaction, so if it refuses, nothing has been written.
     */
    const { skippedQuantityTracked } = bulkAssetIds.length
      ? await bulkCheckOutAssets({
          userId: user.id,
          role,
          assetIds: bulkAssetIds,
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
        })
      : { skippedQuantityTracked: 0 };

    /**
     * The per-unit writes were checked above, so a refusal here can only come
     * from a concurrent change to that asset. By then other writes have
     * committed, so it is reported by asset (`refusedQuantities`) rather than
     * as an error for the whole request, which the app would keep and retry.
     */
    const refusedQuantities = await assignQuantities({
      quantityAssetIds,
      quantities,
      custodian: teamMember,
      userId: user.id,
      organizationId,
      role,
    });

    // The service skips QUANTITY_TRACKED ids that came without a quantity in a
    // mixed list, and refuses a list of only such ids. Forward the skipped
    // count so the app can say so, as the web's assets.bulk-assign-custody.ts
    // does. `refusedQuantities` is present only when a per-unit write was
    // refused; nothing was written for those assets.
    // `movedQuantityAssetIds` tells the app which unit rows went, so it never
    // reads a skipped count as "this server ignored the units".
    const refusedIds = new Set(refusedQuantities.map((r) => r.assetId));
    return data({
      success: true,
      skippedQuantityTracked,
      movedQuantityAssetIds: quantityAssetIds.filter(
        (id) => !refusedIds.has(id)
      ),
      ...(refusedQuantities.length ? { refusedQuantities } : {}),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
