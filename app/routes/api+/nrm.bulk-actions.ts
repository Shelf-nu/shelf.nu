import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { BulkDeleteNRMSchema } from "~/components/nrm/bulk-delete-dialog";
import { bulkDeleteNRMs } from "~/modules/team-member/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
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
      "bulk-delete": PermissionAction.update,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { nrmIds } = parseData(formData, BulkDeleteNRMSchema);

        await bulkDeleteNRMs({ nrmIds, organizationId });

        sendNotification({
          title: "Non-registered members deleted",
          message: "Your non-registered members has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: userId,
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
