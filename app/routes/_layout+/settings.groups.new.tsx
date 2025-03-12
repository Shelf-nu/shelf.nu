import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import GroupForm, { GroupSchema } from "~/components/user-groups/group-form";
import { createNewGroup } from "~/modules/user-groups/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.create,
    });

    return json(data({ showModal: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.userGroups,
      action: PermissionAction.create,
    });

    const formData = await request.formData();
    const { name } = parseData(formData, GroupSchema);

    await createNewGroup({
      name,
      organizationId,
      createdById: userId,
    });

    sendNotification({
      icon: { name: "success", variant: "success" },
      senderId: userId,
      title: "Group created",
      message:
        "Your group has been created successfully. You can start adding your team members.",
    });

    throw redirect("/settings/groups");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function NewGroup() {
  return (
    <div>
      <h4 className="mb-4">Create new group</h4>

      <GroupForm />
    </div>
  );
}
