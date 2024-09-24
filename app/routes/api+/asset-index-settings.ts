import { AssetIndexMode } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { generateColumnsSchema } from "~/modules/asset-index-settings/helpers";
import {
  changeMode,
  updateColumns,
} from "~/modules/asset-index-settings/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
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
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
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

        return json(data({ success: true }));
      }

      case "changeColumns": {
        /**
         * The form already includes all the columsn data, so we don't need to update the data in the DB. We just override it with the new data.
         * We use Zod to validate the data and then return it as a success.
         */

        const customFields = await getActiveCustomFields({
          organizationId,
        });
        const customFieldsNames = customFields.map(
          (field) => `cf_${field.name}`
        );
        const columnsSchema = generateColumnsSchema(customFieldsNames);

        const { columns } = parseData(formData, columnsSchema);
        await updateColumns({
          userId,
          organizationId,
          columns,
        });

        sendNotification({
          title: "Successfully updated columns",
          message:
            "The columns have been successfully updated. The changes will be reflected in the asset index.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
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

        // This is a placeholder for the future
        return json(data({ success: true }));
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

        // This is a placeholder for the future
        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    return json(error(reason), { status: reason.status });
  }
}
