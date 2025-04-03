import { useEffect } from "react";
import { json, redirect } from "@remix-run/node";
import type {
  SerializeFrom,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { atom, useAtom, useAtomValue } from "jotai";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { getPaginatedAndFilterableTeamMembers } from "~/modules/team-member/service.server";
import {
  getGroupById,
  updateGroup,
} from "~/modules/user-groups/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  assertIsPost,
  data,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

const ParamsSchema = z.object({ groupId: z.string() });

const selectedTeamMemberAtom = atom<string[]>([]);

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { groupId } = getParams(params, ParamsSchema);

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.update,
    });

    const group = await getGroupById({ id: groupId, organizationId });

    const { page, perPage, search, teamMembers, totalPages, totalTeamMembers } =
      await getPaginatedAndFilterableTeamMembers({
        request,
        organizationId,
      });

    const modelName = {
      singular: "group",
      plural: "groups",
    };

    return json(
      data({
        showModal: true,
        noScroll: true,
        group,
        header: {
          title: `Manage team members for ${group.name}`,
        },
        searchFieldLabel: "Search your group by name",
        searchFieldTooltip: {
          title: "Search group by name",
        },
        items: teamMembers,
        totalItems: totalTeamMembers,
        modelName,
        page,
        perPage,
        search,
        totalPages,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, groupId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { groupId } = getParams(params, ParamsSchema);

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const { teamMemberIds } = parseData(
      formData,
      z.object({ teamMemberIds: z.string().array().default([]) })
    );

    await updateGroup({
      id: groupId,
      organizationId,
      teamMemberIds,
    });

    sendNotification({
      icon: { name: "success", variant: "success" },
      senderId: userId,
      title: "Success",
      message: "Team members updated successfully.",
    });

    return redirect("/settings/groups");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, groupId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AddMembersInGroup() {
  const { header, totalItems, group } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const [selectedTeamMembers, setSelectedTeamMember] = useAtom(
    selectedTeamMemberAtom
  );

  useEffect(
    function setDefaultSelectedTeamMembers() {
      setSelectedTeamMember(group.teamMembers.map((tm) => tm.id));
    },
    [group.teamMembers, setSelectedTeamMember]
  );

  return (
    <div className="flex h-full max-h-full flex-col">
      <Header
        {...header}
        hideBreadcrumbs
        classNames="text-left mb-3 -mx-6 [&>div]:px-6 -mt-6"
      />

      <div className="-mx-6 border-b px-6 md:pb-3">
        <Filters className="md:border-0 md:p-0" />
      </div>

      <div className="-mx-6  flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={TeamMemberRow}
          navigate={(teamMemberId) => {
            setSelectedTeamMember((prev) =>
              prev.includes(teamMemberId)
                ? prev.filter((tm) => tm !== teamMemberId)
                : [...prev, teamMemberId]
            );
          }}
          className="-mx-5 flex h-full flex-col justify-start border-0"
        />
      </div>

      <footer className="item-center -mx-6 flex justify-between border-t px-6 pt-3">
        <p>{totalItems} groups selected</p>

        <div className="flex gap-3">
          <Button variant="secondary" to="..">
            Close
          </Button>
          <Form method="post">
            {selectedTeamMembers.map((teamMemberId, i) => (
              <input
                key={teamMemberId}
                type="hidden"
                name={`teamMemberIds[${i}]`}
                value={teamMemberId}
              />
            ))}
            <Button type="submit" disabled={disabled}>
              Confirm
            </Button>
          </Form>
        </div>
      </footer>
    </div>
  );
}

function TeamMemberRow({
  item,
}: {
  item: SerializeFrom<typeof loader>["items"][number];
}) {
  const selectedTeamMembers = useAtomValue(selectedTeamMemberAtom);
  const checked = selectedTeamMembers.includes(item.id);

  return (
    <>
      <Td className="w-full">{resolveTeamMemberName(item)}</Td>
      <Td>
        <FakeCheckbox
          className={tw("text-white", checked ? "text-primary" : "")}
          checked={checked}
        />
      </Td>
    </>
  );
}
