import { AssetIndexMode } from "@prisma/client";
import { data, redirect, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import type {
  Column,
  ColumnLabelKey,
} from "~/modules/asset-index-settings/helpers";
import { generateColumnsSchema } from "~/modules/asset-index-settings/helpers";
import {
  changeMode,
  updateColumns,
} from "~/modules/asset-index-settings/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const AssetSettingsSchema = z.object({
  mode: z.enum(Object.values(AssetIndexMode) as [AssetIndexMode]),
});

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetIndexSettings,
      action: PermissionAction.update,
    });

    const formData = await request.clone().formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum([
          "changeMode",
          "changeColumns",
          "changeFreeze",
          "changeShowImage",
        ]),
      })
    );

    switch (intent) {
      case "changeMode": {
        const { mode } = parseData(formData, AssetSettingsSchema);

        await changeMode({
          userId,
          organizationId,
          mode,
        });

        // Redirect to the assets page, so the loader takes care of setting the correct search params and filters based on the mode
        return redirect("/assets");
      }

      case "changeColumns": {
        /**
         * The form already includes all the columsn data, so we don't need to update the data in the DB. We just override it with the new data.
         * We use Zod to validate the data and then return it as a success.
         */

        const customFields = await getActiveCustomFields({
          organizationId,
          includeAllCategories: true,
        });
        const customFieldsNames = customFields.map(
          (field) => `cf_${field.name}`
        );

        const columnsSchema = generateColumnsSchema(customFieldsNames);

        const parsedData = parseData(formData, columnsSchema, {
          // Stale custom field references (e.g. deleted cf) cause
          // expected validation failures that aren't actionable
          shouldBeCaptured: false,
        });

        // Ensure the parsed columns match the Column type
        const typedColumns: Column[] = parsedData.columns.map((column) => ({
          name: column.name as ColumnLabelKey,
          visible: column.visible,
          position: column.position,
          cfType: column.cfType,
        }));

        await updateColumns({
          userId,
          organizationId,
          columns: typedColumns,
        });

        sendNotification({
          title: "Successfully updated columns",
          message:
            "The columns have been successfully updated. The changes will be reflected in the asset index.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true }));
      }

      case "changeFreeze": {
        const { freezeColumn } = parseData(
          formData,
          z.object({
            freezeColumn: z.string().transform((value) => value === "yes"),
          })
        );

        await db.assetIndexSettings.update({
          where: { userId_organizationId: { userId, organizationId } },
          data: { freezeColumn },
        });

        return data(payload({ success: true }));
      }

      case "changeShowImage": {
        const { showAssetImage } = parseData(
          formData,
          z.object({
            showAssetImage: z.string().transform((value) => value === "yes"),
          })
        );

        await db.assetIndexSettings.update({
          where: { userId_organizationId: { userId, organizationId } },
          data: { showAssetImage },
        });

        return data(payload({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return data(payload(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    return data(error(reason), { status: reason.status });
  }
}
