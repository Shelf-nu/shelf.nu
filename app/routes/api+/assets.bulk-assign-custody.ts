import { OrganizationRoles } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { BulkAssignCustodySchema } from "~/components/assets/bulk-assign-custody-dialog";
import { db } from "~/database/db.server";
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
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

    const { organizationId, role } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const formData = await request.formData();

    const { assetIds, custodian, currentSearchParams } = parseData(
      formData,
      BulkAssignCustodySchema.and(CurrentSearchParamsSchema)
    );

    if (role === OrganizationRoles.SELF_SERVICE) {
      const teamMember = await db.teamMember.findUnique({
        where: { id: custodian.id },
        select: { id: true, userId: true },
      });

      if (teamMember?.userId !== userId) {
        throw new ShelfError({
          cause: null,
          title: "Action not allowed",
          message: "Self user can only assign custody to themselves only.",
          additionalData: { userId, assetIds, custodian },
          label: "Assets",
        });
      }
    }

    await bulkCheckOutAssets({
      userId,
      assetIds,
      custodianId: custodian.id,
      custodianName: custodian.name,
      organizationId,
      currentSearchParams,
    });

    sendNotification({
      title: `Assets are now in custody of ${custodian.name}`,
      message:
        "Remember, these assets will be unavailable until it is manually checked in.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
