import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { archivedAssetMessage } from "~/modules/asset/archive-messages";
import { isModelShortfallMessage } from "~/modules/asset/archive-shortfall";
import { archiveAsset } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * The error `reason` sent with the model-reservation shortfall warning, so the
 * app offers "Archive anyway" without matching on the message text.
 */
export const MODEL_SHORTFALL_REASON = "model_shortfall";

/**
 * POST /api/mobile/asset/archive
 *
 * Archives an asset from the companion: it drops out of the default lists and
 * can no longer be booked or put in custody, until someone reinstates it. The
 * same service and the same grant as the web asset page's "Archive"
 * (`asset: archive`, held by admins and owners), so the phone can do exactly
 * what that button does and nothing more. Every refusal comes from
 * `archiveAsset`; this route adds no rule of its own.
 *
 * Body: { assetId: string, confirmModelShortfall?: boolean }
 * Response: { asset: { id, archivedAt }, draftBookings: [{ id, name }], message }
 *
 * `message` is the web's "Asset archived" toast text, including the note on
 * draft bookings that still hold the asset.
 *
 * Refusals reach the app as `{ error: { message } }` with the service's
 * status. The model-reservation warning (409, the archive rolled back) also
 * carries `reason: "model_shortfall"`; the app then asks and resends with
 * `confirmModelShortfall: true`, as the web's "Archive anyway" does.
 *
 * @see {@link file://./../../_layout+/assets.$assetId.tsx} the web "archive" intent
 * @see {@link file://./asset.reinstate.ts} the reverse
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

    const { assetId, confirmModelShortfall } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1, "Asset ID is required"),
        confirmModelShortfall: z.boolean().optional(),
      }),
      request,
      "Assets"
    );

    // why: actorUserId attributes the ASSET_ARCHIVED event and the notes to
    // the mobile user instead of recording them as a system action.
    const { id, archivedAt, draftBookings } = await archiveAsset({
      id: assetId,
      organizationId,
      actorUserId: user.id,
      confirmModelShortfall: confirmModelShortfall === true,
    });

    return data({
      asset: { id, archivedAt },
      draftBookings: draftBookings.map(({ id, name }) => ({ id, name })),
      message: archivedAssetMessage(draftBookings),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      {
        error: {
          message: reason.message,
          ...(isModelShortfallMessage(reason.message)
            ? { reason: MODEL_SHORTFALL_REASON }
            : {}),
        },
      },
      { status: reason.status }
    );
  }
}
