import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BulkActivateCustomFieldSchema } from "~/components/custom-fields/bulk-activate-dialog";
import { BulkDeactivateCustomFieldSchema } from "~/components/custom-fields/bulk-deactivate-dialog";
import { sbDb } from "~/database/supabase.server";
import { bulkActivateOrDeactivateCustomFields } from "~/modules/custom-field/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
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

        let activateQuery = sbDb
          .from("CustomField")
          .select("*")
          .eq("organizationId", organizationId)
          .is("deletedAt", null);

        if (!customFieldIds.includes(ALL_SELECTED_KEY)) {
          activateQuery = activateQuery.in("id", customFieldIds);
        }

        const { data: newActivatingFields, error: activateError } =
          await activateQuery;

        if (activateError) throw activateError;

        await assertWillExceedCustomFieldLimit({
          organizationId,
          organizations,
          newActivatingFields: (newActivatingFields ?? []).length,
        });

        await bulkActivateOrDeactivateCustomFields({
          customFields: newActivatingFields ?? [],
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

        return data(payload({ success: true }));
      }

      case "bulk-deactivate": {
        const { customFieldIds } = parseData(
          formData,
          BulkDeactivateCustomFieldSchema
        );
        let deactivateQuery = sbDb
          .from("CustomField")
          .select("*")
          .eq("organizationId", organizationId)
          .is("deletedAt", null);

        if (!customFieldIds.includes(ALL_SELECTED_KEY)) {
          deactivateQuery = deactivateQuery.in("id", customFieldIds);
        }

        const { data: deactivatingFields, error: deactivateError } =
          await deactivateQuery;

        if (deactivateError) throw deactivateError;

        await bulkActivateOrDeactivateCustomFields({
          customFields: deactivatingFields ?? [],
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
