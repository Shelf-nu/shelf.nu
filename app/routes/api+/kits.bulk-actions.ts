import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { BulkDeleteKitsSchema } from "~/components/kits/bulk-delete-dialog";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { bulkDeleteKits } from "~/modules/kit/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const formData = await request.formData();

    const { intent, currentSearchParams } = parseData(
      formData,
      z
        .object({
          intent: z.enum(["bulk-delete"]),
        })
        .and(CurrentSearchParamsSchema)
    );

    const intent2ActionMap: Record<typeof intent, PermissionAction> = {
      "bulk-delete": PermissionAction.delete,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: intent2ActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { kitIds } = parseData(formData, BulkDeleteKitsSchema);

        await bulkDeleteKits({
          kitIds,
          organizationId,
          userId,
          currentSearchParams,
        });

        sendNotification({
          title: "Kits deleted",
          message: "Your kits has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
