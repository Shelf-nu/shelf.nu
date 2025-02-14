import { json, type ActionFunctionArgs } from "@remix-run/node";
import { BulkUpdateTagsSchema } from "~/components/assets/bulk-assign-tags-dialog";
import { bulkAssignAssetTags } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
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
    const searchParams = getCurrentSearchParams(request);
    const remove = searchParams.get("remove") === "true";

    const formData = await request.formData();

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // Validate form data using combined schema
    const { assetIds, tags, currentSearchParams } = parseData(
      formData,
      BulkUpdateTagsSchema.and(CurrentSearchParamsSchema),
      {
        message: "Invalid tag assignment data provided",
        additionalData: { userId, organizationId },
      }
    );

    await bulkAssignAssetTags({
      userId,
      assetIds,
      tagsIds: tags,
      organizationId,
      currentSearchParams,
      remove,
    });

    sendNotification({
      title: "Assets updated",
      message: "Your asset's tags have been successfully updated",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
