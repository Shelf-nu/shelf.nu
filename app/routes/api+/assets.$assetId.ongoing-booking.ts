import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { getOngoingBookingForAsset } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const booking = await getOngoingBookingForAsset({
      assetId,
      organizationId,
    });

    return json(payload(booking));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw reason;
  }
}
