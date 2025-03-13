import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UsersIcon } from "lucide-react";
import { z } from "zod";
import GroupForm, { GroupSchema } from "~/components/user-groups/group-form";
import {
  getGroupById,
  updateGroup,
} from "~/modules/user-groups/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const ParamsSchema = z.object({ groupId: z.string() });

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

    return json(data({ showModal: true, group }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { groupId } = getParams(params, ParamsSchema);

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const payload = parseData(formData, GroupSchema);

    await updateGroup({
      id: groupId,
      organizationId,
      name: payload.name,
    });

    sendNotification({
      icon: { name: "success", variant: "success" },
      title: "Success",
      message: "Your group is updated successfully.",
      senderId: userId,
    });

    return redirect("/settings/groups");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, groupId });
    return json(error(reason), { status: reason.status });
  }
}

export default function EditGroup() {
  const { group } = useLoaderData<typeof loader>();

  return (
    <div>
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-50">
        <UsersIcon className="size-5 text-primary-500" />
      </div>

      <h4 className="mb-4">Edit {group?.name}</h4>

      <GroupForm name={group?.name} />
    </div>
  );
}
