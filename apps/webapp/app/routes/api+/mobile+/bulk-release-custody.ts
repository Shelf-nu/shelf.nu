import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  mobileBulkIdsSchema,
  mobileQuantitiesSchema,
} from "~/modules/api/mobile-bulk-ids.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  releaseQuantities,
  resolveQuantityReleases,
  splitQuantityAssetIds,
} from "~/modules/custody/quantity-custody.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bulk-release-custody
 *
 * Releases custody of multiple assets (bulk check-in).
 * Body: { assetIds: string[], quantities?: Record<assetId, units> }
 * Response: { success: true, skippedQuantityTracked, refusedQuantities? }
 *
 * `quantities` comes from the companion's Scan tab, which gives each
 * quantity-tracked row a unit count. An asset named there is released unit by
 * unit from its single operator holder, through the shared quantity-custody
 * functions, exactly as the web scanner's route does, after every named asset
 * has been resolved and checked. All other ids take the bulk path. Without
 * `quantities` the route behaves as it always has: quantity-tracked ids are
 * skipped in a mixed list, and a list of only quantity-tracked ids is refused.
 *
 * @see {@link file://./../assets.bulk-release-custody.ts} the web twin
 * @see {@link file://./../../../modules/custody/quantity-custody.server.ts}
 */
export async function action({ request }: ActionFunctionArgs) {
  // why: bound outside the try so the catch can attach it to the error
  // context — aligns this route with its custody.assign / bulk-assign
  // siblings, which already do this.
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

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

    const { assetIds, quantities } = parsed.data;
    const { quantityAssetIds, bulkAssetIds } = splitQuantityAssetIds(
      assetIds,
      quantities
    );

    const { role, canUseBarcodes, canSeeAllCustody } =
      await getMobileUserContext(user.id, organizationId);

    const settings = await getAssetIndexSettings({
      userId: user.id,
      organizationId,
      canUseBarcodes,
      role,
    });

    // Each per-unit release is resolved to its single holder and checked
    // before anything is written.
    const resolvedReleases = await resolveQuantityReleases({
      quantityAssetIds,
      quantities,
      organizationId,
      role,
      userId: user.id,
    });

    /**
     * Pass `role` so the service-level SELF_SERVICE guard fires.
     * Without it, a SELF_SERVICE user could release custody on any
     * team member's asset (hex-security r3202161632).
     *
     * The whole-asset call runs before the per-unit releases, as on the web
     * route: it validates and writes in one transaction, so if it refuses,
     * nothing has been written.
     */
    const { skippedQuantityTracked } = bulkAssetIds.length
      ? await bulkCheckInAssets({
          userId: user.id,
          role,
          assetIds: bulkAssetIds,
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

    // Checked above, so a refusal here can only come from a concurrent change
    // to that asset; it is reported by asset (see the assign route).
    // `releaseQuantity` also applies the SELF_SERVICE rule on each write.
    const refusedQuantities = await releaseQuantities({
      releases: resolvedReleases,
      quantities,
      userId: user.id,
      organizationId,
      role,
    });

    // The service skips QUANTITY_TRACKED ids that came without a quantity in a
    // mixed list, and refuses a list of only such ids. Forward the skipped
    // count so the app can say so, as the web's assets.bulk-release-custody.ts
    // does.
    return data({
      success: true,
      skippedQuantityTracked,
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
