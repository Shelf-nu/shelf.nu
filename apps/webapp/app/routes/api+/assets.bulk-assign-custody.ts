import { data, type ActionFunctionArgs } from "react-router";
import { BulkAssignCustodySchema } from "~/components/assets/bulk-assign-custody-dialog";
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import {
  isLikeShelfError,
  isNotFoundError,
  makeShelfError,
  ShelfError,
} from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role, canUseBarcodes } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const formData = await request.formData();

    const { assetIds, custodian, currentSearchParams } = parseData(
      formData,
      BulkAssignCustodySchema.and(CurrentSearchParamsSchema)
    );

    /**
     * Validate the custodian belongs to the same organization. We don't
     * keep the result around any more — the SELF_SERVICE "assign-to-
     * self" guard moved into `bulkCheckOutAssets` (which fetches the
     * team member itself). The lookup here is still needed: it 404s
     * the request if the requested custodianId is from another org or
     * doesn't exist.
     */
    await getTeamMember({
      id: custodian.id,
      organizationId,
      select: { id: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId, assetIds, custodian },
        label: "Assets",
        status: 404,
        // `getTeamMember` already classifies its errors — forward that
        // decision so DB / connectivity failures inside it still reach
        // Sentry. Fall back to the Prisma not-found check otherwise.
        shouldBeCaptured: isLikeShelfError(cause)
          ? cause.shouldBeCaptured
          : !isNotFoundError(cause),
      });
    });

    /**
     * The SELF_SERVICE "assign-to-self" guard now lives inside
     * `bulkCheckOutAssets` itself (centralised so web + mobile share
     * one source of truth). We just pass `role` through.
     */
    const { skippedQuantityTracked } = await bulkCheckOutAssets({
      userId,
      assetIds,
      custodianId: custodian.id,
      custodianName: custodian.name,
      organizationId,
      currentSearchParams,
      settings,
      role,
    });

    const skippedNote =
      skippedQuantityTracked > 0
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped — assign custody individually.`
        : "";

    sendNotification({
      title: `Assets are now in custody of ${custodian.name}`,
      message: `Remember, these assets will be unavailable until custody is manually released.${skippedNote}`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
