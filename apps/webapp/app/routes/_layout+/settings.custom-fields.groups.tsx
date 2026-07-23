import { ArrowUpIcon, ArrowDownIcon, TrashIcon } from "@radix-ui/react-icons";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Link, useLoaderData, Form } from "react-router";
import { z } from "zod";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import {
  createCustomFieldGroup,
  deleteCustomFieldGroup,
  getCustomFieldGroups,
  reorderCustomFieldGroups,
} from "~/modules/custom-field/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const title = "Manage Custom Field Groups";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.read,
    });

    const groups = await getCustomFieldGroups({ organizationId });

    const header = {
      title,
    };

    return payload({
      header,
      groups,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

const GroupActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    name: z.string().min(1, "Name is required"),
  }),
  z.object({
    intent: z.literal("delete"),
    id: z.string(),
  }),
  z.object({
    intent: z.literal("reorder"),
    groupIds: z.string(), // comma-separated IDs
  }),
]);

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.update,
    });

    const body = parseData(await request.formData(), GroupActionSchema);

    if (body.intent === "create") {
      const existing = await getCustomFieldGroups({ organizationId });
      await createCustomFieldGroup({
        name: body.name,
        organizationId,
        position: existing.length,
      });

      sendNotification({
        title: "Group created",
        message: `Group "${body.name}" has been created.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
    } else if (body.intent === "delete") {
      await deleteCustomFieldGroup({ id: body.id, organizationId });

      sendNotification({
        title: "Group deleted",
        message: "The group has been deleted.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
    } else if (body.intent === "reorder") {
      const ids = body.groupIds.split(",").filter(Boolean);
      await reorderCustomFieldGroups({ organizationId, groupIds: ids });
    }

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function CustomFieldGroupsPage() {
  const { groups } = useLoaderData<typeof loader>();

  const handleMove = (index: number, direction: "up" | "down") => {
    const newGroups = [...groups];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newGroups.length) return;

    // Swap
    const temp = newGroups[index];
    newGroups[index] = newGroups[targetIndex];
    newGroups[targetIndex] = temp;

    const ids = newGroups.map((g) => g.id).join(",");
    const formData = new FormData();
    formData.append("intent", "reorder");
    formData.append("groupIds", ids);

    const form = document.getElementById("reorder-form") as HTMLFormElement;
    if (form) {
      const input = form.querySelector(
        'input[name="groupIds"]'
      ) as HTMLInputElement;
      if (input) {
        input.value = ids;
        form.requestSubmit();
      }
    }
  };

  return (
    <>
      <Header hideBreadcrumbs title={title} classNames="-mt-5" />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Create new group */}
        <div className="w-full lg:w-1/3">
          <Card className="p-5">
            <h3 className="mb-4 text-base font-semibold">Create New Group</h3>
            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="create" />
              <FormRow
                rowLabel="Group Name"
                className="border-b-0 py-0"
                required
              >
                <Input
                  label="Group Name"
                  hideLabel
                  name="name"
                  placeholder="e.g. Procurement"
                  required
                  className="w-full"
                />
              </FormRow>
              <Button
                type="submit"
                variant="primary"
                className="w-full justify-center"
              >
                Create Group
              </Button>
            </Form>
          </Card>
        </div>

        {/* List and reorder groups */}
        <div className="w-full lg:w-2/3">
          <Card className="p-5">
            <h3 className="mb-4 text-base font-semibold">Existing Groups</h3>
            <Form id="reorder-form" method="post" className="hidden">
              <input type="hidden" name="intent" value="reorder" />
              <input type="hidden" name="groupIds" value="" />
            </Form>

            {groups.length === 0 ? (
              <div className="py-6 text-center text-gray-500">
                No groups created yet. Create a group on the left to start
                organizing your custom fields.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {groups.map((group, index) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">
                        {group.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        Position: {group.position}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Re-order controls */}
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={index === 0}
                        onClick={() => handleMove(index, "up")}
                        title="Move Up"
                        className="p-2"
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={index === groups.length - 1}
                        onClick={() => handleMove(index, "down")}
                        title="Move Down"
                        className="p-2"
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>

                      {/* Delete */}
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={group.id} />
                        <Button
                          type="submit"
                          variant="secondary"
                          className="p-2 text-red-600 hover:bg-red-50"
                          title="Delete Group"
                        >
                          <TrashIcon className="size-4" />
                        </Button>
                      </Form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Link
          to="/settings/custom-fields"
          className="text-sm font-medium text-primary hover:underline"
        >
          &larr; Back to Custom Fields
        </Link>
      </div>
    </>
  );
}
