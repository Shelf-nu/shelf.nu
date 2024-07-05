import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Outlet, redirect } from "@remix-run/react";
import { getAssetByPropertyId } from "~/modules/asset/service.server";
import { z } from "zod";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { makeShelfError } from "~/utils/error";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { propertyId } = getParams(params, z.object({ propertyId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const asset = await getAssetByPropertyId({
      propertyId,
      organizationId,
      include: {},
    });

    return redirect(`/assets/${asset.id}`);

  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}

export default function Property() {
  return <Outlet />;
}
