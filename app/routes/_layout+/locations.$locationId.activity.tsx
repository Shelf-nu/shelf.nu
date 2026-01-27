import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { NoPermissionsIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import { LocationNotes } from "~/components/location/notes";
import TextualDivider from "~/components/shared/textual-divider";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getLocation } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { getLocationNotes } from "~/modules/location-note/service.server";

const paramsSchema = z.object({ locationId: z.string() });

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.locationNote,
      action: PermissionAction.read,
    });

    const { location } = await getLocation({
      organizationId,
      id: locationId,
      userOrganizations,
      request,
      include: {
        notes: {
          select: { id: true },
        },
      },
    });

    const notes = await getLocationNotes({
      locationId,
      organizationId,
    });

    const header: HeaderData = {
      title: `${location.name}'s activity`,
    };

    return json(
      data({
        location: { id: location.id, name: location.name },
        notes,
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { locationId, userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Activity",
};

export default function LocationActivity() {
  const { roles } = useUserRoleHelper();
  const canReadNotes = userHasPermission({
    roles,
    entity: PermissionEntity.locationNote,
    action: PermissionAction.read,
  });
  const canCreateNotes = userHasPermission({
    roles,
    entity: PermissionEntity.locationNote,
    action: PermissionAction.create,
  });
  const canDeleteNotes = userHasPermission({
    roles,
    entity: PermissionEntity.locationNote,
    action: PermissionAction.delete,
  });

  return (
    <div className="w-full">
      {canReadNotes ? (
        <>
          <TextualDivider text="Notes" className="mb-8 lg:hidden" />
          <LocationNotes
            canCreate={canCreateNotes}
            canDelete={canDeleteNotes}
          />
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view location notes</p>
          </div>
        </div>
      )}
    </div>
  );
}
