import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { bulkReleaseCustody } from "~/modules/asset/service.server";
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
  try {
    const { user } = await requireMobileAuth(request);
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

    await bulkReleaseCustody({
      userId: user.id,
      assetIds,
      organizationId,
      currentSearchParams: "",
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
