import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BulkDeleteCategorySchema } from "~/components/category/bulk-delete-dialog";
import { bulkDeleteCategories } from "~/modules/category/service.server";
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
      entity: PermissionEntity.category,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { categoryIds } = parseData(formData, BulkDeleteCategorySchema);

        await bulkDeleteCategories({ categoryIds, organizationId });

        sendNotification({
          title: "Categories deleted",
          message: "Your categories has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: userId,
        });

        return payload({ success: true });
      }

      default: {
        checkExhaustiveSwitch(intent);
        return payload(null);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
