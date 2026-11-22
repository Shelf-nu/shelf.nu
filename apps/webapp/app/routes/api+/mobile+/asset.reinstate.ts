import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { unarchiveAsset } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/asset/reinstate
 *
 * Reinstates an archived asset from the companion: it becomes active again,
 * bookable and changeable. The same service and the same grant as the web
 * asset page's "Reinstate" (`asset: archive`, held by admins and owners), so
 * the phone can do exactly what that button does and nothing more.
 *
 * Body: { assetId: string }
 * Response: { asset: { id, archivedAt: null } }
 *
 * The service refuses an asset that is not archived (409) and one whose kit is
 * in custody or checked out (400); both reach the app as `{ error: { message } }`.
 *
 * @see {@link file://./../../_layout+/assets.$assetId.tsx} the web "reinstate" intent
 */
export async function action({ request }: ActionFunctionArgs) {
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
      action: PermissionAction.archive,
    });

    const { assetId } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1, "Asset ID is required"),
      }),
      request,
      "Assets"
    );

    // why: actorUserId attributes the ASSET_UNARCHIVED event to the mobile
    // user instead of recording it as a system action.
    const { id } = await unarchiveAsset({
      id: assetId,
      organizationId,
      actorUserId: user.id,
    });

    return data({ asset: { id, archivedAt: null } });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
