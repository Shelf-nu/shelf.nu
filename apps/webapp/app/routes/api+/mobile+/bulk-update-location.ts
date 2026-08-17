import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { mobileBulkIdsSchema } from "~/modules/api/mobile-bulk-ids.server";
import { bulkUpdateAssetLocation } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bulk-update-location
 *
 * Updates the location of multiple assets at once.
 * Body: { assetIds: string[], locationId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // safeParse, not parse: a raw ZodError reaches `makeShelfError`'s
    // unknown branch and surfaces as a captured 500 "Sorry, something went
    // wrong". A malformed body is a client error, and the select-all
    // rejection below is an EXPECTED one — reporting it as a server outage
    // would bury it in Sentry.
    const parsed = z
      .object({
        assetIds: mobileBulkIdsSchema("assetIds"),
        locationId: z.string().min(1),
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

    const { assetIds, locationId } = parsed.data;

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

    await bulkUpdateAssetLocation({
      userId: user.id,
      assetIds,
      organizationId,
      newLocationId: locationId,
      currentSearchParams: null,
      settings,
    });

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
