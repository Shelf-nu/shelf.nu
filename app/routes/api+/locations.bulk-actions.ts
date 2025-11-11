import { data, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { BulkDeleteLocationSchema } from "~/components/location/bulk-delete-dialog";
import { bulkDeleteLocations } from "~/modules/location/service.server";
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
      entity: PermissionEntity.location,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { locationIds } = parseData(formData, BulkDeleteLocationSchema);

        await bulkDeleteLocations({ locationIds, organizationId });

        sendNotification({
          title: "Locations deleted",
          message: "Your locations has been deleted successfully",
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
