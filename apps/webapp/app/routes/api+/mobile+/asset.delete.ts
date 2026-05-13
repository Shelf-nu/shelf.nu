import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { deleteAsset } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/asset/delete
 *
 * Deletes an asset from mobile.
 * Body: { assetId: string }
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
      action: PermissionAction.delete,
    });

    const body = await request.json();
    const { assetId } = z
      .object({
        assetId: z.string().min(1, "Asset ID is required"),
      })
      .parse(body);

    // why: passing actorUserId so the ASSET_DELETED event is attributed to
    // the mobile user instead of recording as a system-initiated delete.
    await deleteAsset({ id: assetId, organizationId, actorUserId: user.id });

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
