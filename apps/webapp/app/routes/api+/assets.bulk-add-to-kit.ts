import { KitStatus } from "@prisma/client";
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { BulkAddToKitSchema } from "~/components/assets/bulk-add-to-kit-dialog";
import { db } from "~/database/db.server";
import { updateKitAssets } from "~/modules/kit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * This loader is used to get all the kits that can be bulk added to.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const kits = await db.kit.findMany({
      where: {
        organizationId,
        status: { not: KitStatus.CHECKED_OUT },
      },
      select: {
        id: true,
        name: true,
      },
    });

    return data(payload({ kits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { assetIds, kit } = parseData(
      await request.formData(),
      BulkAddToKitSchema,
      {
        additionalData: { userId, organizationId },
      }
    );

    const updatedKit = await updateKitAssets({
      kitId: kit,
      assetIds,
      organizationId,
      userId,
      request,
      addOnly: true, // Only add assets, don't remove existing ones
    });

    sendNotification({
      icon: { name: "success", variant: "success" },
      senderId: userId,
      title: "Bulk assets added to kit",
      message: `Successfully added ${assetIds.length} assets to kit "${updatedKit.name}".`,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
