import { KitStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { BulkAddToKitSchema } from "~/components/assets/bulk-add-to-kit-dialog";
import { db } from "~/database/db.server";
import { updateKitAssets } from "~/modules/kit/service.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
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

    return json(data({ kits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
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

    await updateKitAssets({
      kitId: kit,
      assetIds,
      organizationId,
      userId,
      request,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
