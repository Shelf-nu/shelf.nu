import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { BulkActivateCustomFieldSchema } from "~/components/custom-fields/bulk-activate-dialog";
import { BulkDeactivateCustomFieldSchema } from "~/components/custom-fields/bulk-deactivate-dialog";
import { db } from "~/database/db.server";
import {
  bulkActivateOrDeactivateCustomFields,
  countActiveCustomFields,
} from "~/modules/custom-field/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import {
  canCreateMoreCustomFields,
  willExceedCustomFieldLimit,
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
        const { customFieldIds } = parseData(
          formData,
          BulkActivateCustomFieldSchema
        );

        const newActivatingFields = await db.customField.count({
          where: customFieldIds.includes(ALL_SELECTED_KEY)
            ? { organizationId }
            : { id: { in: customFieldIds } },
        });

        /** We have to make sure that user is not already at the limit */
        const tierLimit = await getOrganizationTierLimit({
          organizationId,
          organizations,
        });

        const totalActiveCustomFields = await countActiveCustomFields({
          organizationId,
        });

        const canCreateMore = canCreateMoreCustomFields({
          tierLimit,
          totalCustomFields: totalActiveCustomFields,
        });

        if (!canCreateMore) {
          throw new ShelfError({
            cause: null,
            message:
              "You have reached your limit of active custom fields. Please upgrade your plan to add more.",
            additionalData: { userId, totalActiveCustomFields, tierLimit },
            label: "Custom fields",
            status: 403,
            shouldBeCaptured: false,
          });
        }

        /** We have to make sure that the new activating fields is not exceeding the allowed limit */
        const willExceedCustomFieldsLimit = willExceedCustomFieldLimit({
          tierLimit,
          currentCustomFields: totalActiveCustomFields,
          newActivatingFields,
        });

        if (willExceedCustomFieldsLimit) {
          throw new ShelfError({
            cause: null,
            message:
              "Activating these fields will exceed your allowed limit of active custom fields. Try selecting small number or fields or upgrade your plan to activate more.",
            shouldBeCaptured: false,
            label: "Custom fields",
          });
        }

        await bulkActivateOrDeactivateCustomFields({
          customFieldIds,
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

        await bulkActivateOrDeactivateCustomFields({
          customFieldIds,
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
