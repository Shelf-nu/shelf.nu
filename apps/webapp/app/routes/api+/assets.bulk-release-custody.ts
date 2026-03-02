import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { BulkReleaseCustodySchema } from "~/components/assets/bulk-release-custody-dialog";
import { db } from "~/database/db.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role, canUseBarcodes } = await requirePermission({
      userId,
      request,
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

    const { assetIds, currentSearchParams } = parseData(
      formData,
      BulkReleaseCustodySchema.and(CurrentSearchParamsSchema)
    );

    if (role === OrganizationRoles.SELF_SERVICE) {
      const custodies = await db.custody.findMany({
        where: {
          assetId: { in: assetIds },
          asset: { organizationId },
        },
        select: { custodian: { select: { id: true, userId: true } } },
      });

      if (custodies.some((custody) => custody.custodian.userId !== userId)) {
        throw new ShelfError({
          cause: null,
          title: "Action not allowed",
          message:
            "Self service user can only release custody of assets assigned to their user.",
          additionalData: { userId, assetIds },
          label: "Assets",
        });
      }
    }

    await bulkCheckInAssets({
      userId,
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    sendNotification({
      title: "Assets are no longer in custody",
      message: "These assets are available again.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
