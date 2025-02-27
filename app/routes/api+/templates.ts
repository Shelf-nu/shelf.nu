import { TemplateType } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.read,
    });

    const templates = await db.template.findMany({
      where: {
        isActive: true,
        organizationId,
        type: TemplateType.CUSTODY,
      },
    });

    return json(data({ templates }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}
