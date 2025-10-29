import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { BulkActivateCustomFieldSchema } from "~/components/custom-fields/bulk-activate-dialog";
import { BulkDeactivateCustomFieldSchema } from "~/components/custom-fields/bulk-deactivate-dialog";
import { db } from "~/database/db.server";
import { bulkActivateOrDeactivateCustomFields } from "~/modules/custom-field/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import {
  assertUserCanCreateMoreCustomFields,
  assertWillExceedCustomFieldLimit,
} from "~/utils/subscription.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["bulk-activate", "bulk-deactivate"]) })
    );

    const intentToActionMap: Record<typeof intent, PermissionAction> = {
      "bulk-activate": PermissionAction.update,
      "bulk-deactivate": PermissionAction.update,
    };

    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.customField,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-activate": {
        await assertUserCanCreateMoreCustomFields({
          organizationId,
          organizations,
        });

        const { customFieldIds } = parseData(
          formData,
          BulkActivateCustomFieldSchema
        );

        const newActivatingFields = await db.customField.findMany({
          where: customFieldIds.includes(ALL_SELECTED_KEY)
            ? { organizationId, deletedAt: null }
            : { id: { in: customFieldIds }, deletedAt: null },
        });

        await assertWillExceedCustomFieldLimit({
          organizationId,
          organizations,
          newActivatingFields: newActivatingFields.length,
        });

        await bulkActivateOrDeactivateCustomFields({
          customFields: newActivatingFields,
          organizationId,
          userId,
          active: true,
        });

        sendNotification({
          title: "Custom fields activated",
          message: "Your custom fields have been activated successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }

      case "bulk-deactivate": {
        const { customFieldIds } = parseData(
          formData,
          BulkDeactivateCustomFieldSchema
        );
        const newActivatingFields = await db.customField.findMany({
          where: customFieldIds.includes(ALL_SELECTED_KEY)
            ? { organizationId, deletedAt: null }
            : { id: { in: customFieldIds }, deletedAt: null },
        });

        await bulkActivateOrDeactivateCustomFields({
          customFields: newActivatingFields,
          organizationId,
          userId,
          active: false,
        });

        sendNotification({
          title: "Custom fields deactivated",
          message: "Your custom fields have been deactivated successfully",
          icon: { name: "success", variant: "success" },
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
