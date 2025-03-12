import type { LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import { getPaginatedAndFilterableGroups } from "~/modules/user-groups/service.server";
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
    const { currentOrganization, organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.read,
    });

    const { groups, totalGroups, page, perPage, search, totalPages } =
      await getPaginatedAndFilterableGroups({
        request,
        organizationId,
      });

    const header = { title: "Groups" } satisfies HeaderData;

    const modelName = {
      singular: "group",
      plural: "groups",
    };

    return json(
      data({
        isPersonalOrg: currentOrganization.type === "PERSONAL",
        orgName: currentOrganization.name,
        search,
        header,
        modelName,
        items: groups,
        totalItems: totalGroups,
        page,
        perPage,
        totalPages,
        searchFieldLabel: "Search groups",
        searchFieldTooltip: {
          title: "Search groups",
          text: "Search groups by name",
        },
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

      <ListContentWrapper>
        <Filters>
          <Button className="w-max" to="new">
            Create a group
          </Button>
        </Filters>

        <List
          ItemComponent={GroupRow}
          headerChildren={
            <>
              <Th>Members</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </ListContentWrapper>

      <ContextualModal />
    </div>
  );
}

function GroupRow({
  item,
}: {
  item: SerializeFrom<typeof loader>["items"][number];
}) {
  return (
    <>
      <Td>{item.name}</Td>
      <Td>{item._count.teamMembers}</Td>
      <Td>Actions</Td>
    </>
  );
}
