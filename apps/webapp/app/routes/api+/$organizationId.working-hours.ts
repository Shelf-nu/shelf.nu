import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId: paramOrgId } = getParams(
      params,
      z.object({ organizationId: z.string() }),
      { additionalData: { userId } }
    );

    // Verify user has permission to read working hours for this organization
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.workingHours,
      action: PermissionAction.read,
    });

    // Ensure the requested org matches the user's current org
    if (paramOrgId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message: "Organization access denied",
        label: "Working hours",
      });
    }

    const workingHours = await getWorkingHoursForOrganization(organizationId);

    return data(
      payload({
        workingHours: {
          ...workingHours,
          overrides: workingHours.overrides.map((override) => ({
            ...override,
            date: override.date.toISOString(),
          })),
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
