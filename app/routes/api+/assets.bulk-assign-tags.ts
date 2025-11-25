import { data, type ActionFunctionArgs } from "@remix-run/node";
import { BulkUpdateTagsSchema } from "~/components/assets/bulk-assign-tags-dialog";
import { bulkAssignAssetTags } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
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

    const { organizationId, canUseBarcodes, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
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
      settings,
    });

    sendNotification({
      title: "Assets updated",
      message: "Your asset's tags have been successfully updated",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
