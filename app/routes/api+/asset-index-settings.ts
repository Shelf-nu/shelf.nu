import { AssetIndexMode } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { changeMode } from "~/modules/asset-index-settings/service.server";
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
    const { mode } = parseData(await request.formData(), AssetSettingsSchema);

    await changeMode({
      userId,
      organizationId,
      mode,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    return json(error(reason), { status: reason.status });
  }
}
