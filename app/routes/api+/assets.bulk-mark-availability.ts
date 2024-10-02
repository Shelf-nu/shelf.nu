import { json, type ActionFunctionArgs } from "@remix-run/node";
import { BulkMarkAvailabilitySchema } from "~/components/assets/bulk-mark-availability-dialog";
import { bulkMarkAvailability } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, parseData } from "~/utils/http.server";
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

    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    const { assetIds, type, currentSearchParams } = parseData(
      formData,
      BulkMarkAvailabilitySchema.and(CurrentSearchParamsSchema)
    );

    await bulkMarkAvailability({
      organizationId,
      assetIds,
      type,
      currentSearchParams,
    });

    sendNotification({
      title: `Marked as ${type}.`,
      message: `All the assets are marked as ${type} now.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(reason, { status: reason.status });
  }
}
