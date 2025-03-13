import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
  SerializeFrom,
} from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import ActionsDropdown from "~/components/user-groups/actions-dropdown";
import {
  deleteGroup,
  getPaginatedAndFilterableGroups,
} from "~/modules/user-groups/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data?.header ? appendToMetaTitle(data.header.title) : "",
  },
];

export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const formData = await request.formData();
    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["delete"]) })
    );

    switch (intent) {
      case "delete": {
        const { organizationId } = await requirePermission({
          request,
          userId,
          entity: PermissionEntity.userGroups,
          action: PermissionAction.delete,
        });

        const { groupId } = parseData(
          formData,
          z.object({ groupId: z.string() })
        );

        await deleteGroup({ id: groupId, organizationId });

        sendNotification({
          title: "Success",
          message: "Your group has been deleted successfully.",
          senderId: userId,
          icon: { name: "trash", variant: "error" },
        });

        return json(data({ success: true }));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

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
      <Td>
        <ActionsDropdown group={item} />
      </Td>
    </>
  );
}
