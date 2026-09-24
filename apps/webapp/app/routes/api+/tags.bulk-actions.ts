import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BulkDeleteTagsSchema } from "~/components/tag/bulk-delete-dialog";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { bulkDeleteTags } from "~/modules/tag/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["bulk-delete"]) })
    );

    const intentToActionMap: Record<typeof intent, PermissionAction> = {
      "bulk-delete": PermissionAction.delete,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.tag,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        // `currentSearchParams` carries the filters the user was looking at.
        // Without it a "select all" over a filtered list deletes every tag in
        // the workspace while the UI reports the filtered count.
        const { tagIds, currentSearchParams } = parseData(
          formData,
          BulkDeleteTagsSchema.and(CurrentSearchParamsSchema)
        );

        const { count } = await bulkDeleteTags({
          tagIds,
          organizationId,
          currentSearchParams,
        });

        sendNotification({
          title: count === 1 ? "Tag deleted" : "Tags deleted",
          message: `${count} ${
            count === 1 ? "tag has" : "tags have"
          } been deleted successfully`,
          icon: { name: "trash", variant: "error" },
          senderId: userId,
        });

        return data(payload({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return data(payload(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
