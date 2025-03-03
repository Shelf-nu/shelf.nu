import { CustodyAgreementType } from "@prisma/client";
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
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const agreements = await db.custodyAgreement.findMany({
      where: {
        isActive: true,
        organizationId,
        type: CustodyAgreementType.CUSTODY,
      },
    });

    return json(data({ agreements }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}
