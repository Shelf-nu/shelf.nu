import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getLocation,
  getLocationDescendantsTree,
  getLocationHierarchy,
} from "~/modules/location/service.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({
  locationId: z.string(),
});

export type LocationTreePayload = {
  location: { id: string; name: string };
  ancestors: Array<{ id: string; name: string }>;
  descendants: Awaited<ReturnType<typeof getLocationDescendantsTree>>;
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    // why: requirePermission must resolve first (auth gate + organizationId),
    // and getLocation depends on its result. Hierarchy and descendants below
    // are parallelized once location is resolved.
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    const { location } = await getLocation({
      organizationId,
      id: locationId,
      userOrganizations,
      request,
    });

    // Hierarchy (ancestors) and descendants tree are independent — fetch in parallel
    const [hierarchy, descendants] = await Promise.all([
      getLocationHierarchy({
        organizationId: location.organizationId,
        locationId,
      }),
      getLocationDescendantsTree({
        organizationId: location.organizationId,
        locationId,
      }),
    ]);
    const ancestors =
      hierarchy.length > 1
        ? hierarchy.slice(0, -1).map(({ id, name }) => ({ id, name }))
        : [];

    return data(
      payload<LocationTreePayload>({
        location: { id: location.id, name: location.name },
        ancestors,
        descendants,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}
