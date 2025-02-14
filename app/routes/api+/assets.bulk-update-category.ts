import { json, type ActionFunctionArgs } from "@remix-run/node";
import { BulkCategoryUpdateSchema } from "~/components/assets/bulk-category-update-dialog";
import { bulkUpdateAssetCategory } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
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

    const formData = await request.formData();

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { assetIds, category, currentSearchParams } = parseData(
      formData,
      BulkCategoryUpdateSchema.and(CurrentSearchParamsSchema)
    );

    await bulkUpdateAssetCategory({
      userId,
      assetIds,
      categoryId: category,
      organizationId,
      currentSearchParams,
    });

    sendNotification({
      title: "Assets updated",
      message: "Your asset's categories have been successfully updated",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
