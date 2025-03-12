import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import ContextualModal from "~/components/layout/contextual-modal";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.read,
    });

    const modelName = {
      singular: "group",
      plural: "groups",
    };

    return json(
      data({
        isPersonalOrg: currentOrganization.type === "PERSONAL",
        orgName: currentOrganization.name,
        search: "",
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
};

export default function Groups() {
  const { isPersonalOrg, orgName } = useLoaderData<typeof loader>();

  return (
    <div className="rounded border bg-white p-4">
      <div className="p-4">
        <h2>{isPersonalOrg ? "Groups" : `${orgName}'s groups`}</h2>
        <p className="text-sm text-gray-600">
          Manage your team groups and their members.
        </p>
      </div>

      <Filters>
        <Button className="w-max" to="new">
          Create a group
        </Button>
      </Filters>

      <ContextualModal />
    </div>
  );
}
