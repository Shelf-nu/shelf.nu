import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bulk-release-custody
 *
 * Releases custody of multiple assets (bulk check-in).
 * Body: { assetIds: string[] }
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

    const body = await request.json();
    const { assetIds } = z
      .object({
        assetIds: z.array(z.string().min(1)).min(1),
      })
      .parse(body);

    const { role, canUseBarcodes } = await getMobileUserContext(
      user.id,
      organizationId
    );

    const settings = await getAssetIndexSettings({
      userId: user.id,
      organizationId,
      canUseBarcodes,
      role,
    });

    /**
     * Pass `role` so the service-level SELF_SERVICE guard fires.
     * Without it, a SELF_SERVICE user could release custody on any
     * team member's asset (hex-security r3202161632).
     */
    const { skippedQuantityTracked } = await bulkCheckInAssets({
      userId: user.id,
      role,
      assetIds,
      organizationId,
      currentSearchParams: "",
      settings,
    });

    // Additive: the service silently skips QUANTITY_TRACKED assets on mixed
    // selections (they need a per-asset quantity — use
    // /api/mobile/custody/release-quantity). Forward the count so the app
    // can report it honestly, mirroring the web's
    // assets.bulk-release-custody.ts. An ALL-quantity-tracked selection
    // throws in the service instead and surfaces through the error envelope.
    return data({ success: true, skippedQuantityTracked });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
