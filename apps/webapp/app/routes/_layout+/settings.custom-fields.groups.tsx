/**
 * @file settings.custom-fields.groups.tsx
 * @description Route for managing custom field groups inside the organization's settings.
 * Supports group creation, reordering, and deletion with safety guards and confirmation alerts.
 */

import { useEffect, useState } from "react";
import { ArrowUpIcon, ArrowDownIcon, TrashIcon } from "@radix-ui/react-icons";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Link, useLoaderData, useActionData, Form, useFetcher } from "react-router";
import { z } from "zod";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import {
  createCustomFieldGroup,
  deleteCustomFieldGroup,
  getCustomFieldGroups,
  reorderCustomFieldGroups,
} from "~/modules/custom-field/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const title = "Manage Custom Field Groups";

/**
 * Loader function to retrieve all Custom Field Groups for the organization.
 * Requires customField read permissions.
 *
 * @param args - Loader function arguments containing context and request
 * @returns Payload with loader data (header, groups) or throws serialized error
 */
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
    name: z.string().trim().min(1, "Name is required"),
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

/**
 * Action handler for creating, deleting, or reordering groups.
 * Performs granular permission verification depending on intent.
 *
 * @param args - Loader/Action arguments containing context and request
 * @returns Success payload or error response
 */
export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const body = parseData(await request.formData(), GroupActionSchema);

    // Granular permission check based on action intent
    let permissionAction: PermissionAction = PermissionAction.update;
    if (body.intent === "create") {
      permissionAction = PermissionAction.create;
    } else if (body.intent === "delete") {
      permissionAction = PermissionAction.delete;
    }

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: permissionAction,
    });

    if (body.intent === "create") {
      await createCustomFieldGroup({
        name: body.name,
        organizationId,
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
      const existing = await getCustomFieldGroups({ organizationId });
      const existingIds = existing.map((g) => g.id);

      // Validate that the submitted set matches the organization's complete group set
      const hasDuplicates = new Set(ids).size !== ids.length;
      const isComplete =
        ids.length === existingIds.length &&
        ids.every((id) => existingIds.includes(id));

      if (hasDuplicates || !isComplete) {
        throw new ShelfError({
          cause: null,
          message:
            "Invalid reorder payload: group IDs are invalid, duplicate, or incomplete.",
          label: "Custom fields",
          status: 400,
        });
      }

      await reorderCustomFieldGroups({ organizationId, groupIds: ids });
    }

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * Custom Confirmation Dialog for deleting custom field groups.
 */
export function DeleteCustomFieldGroupDialog({
  group,
  disabled,
}: {
  group: { id: string; name: string };
  disabled: boolean;
}) {
  const fetcher = useFetcher<DataOrErrorResponse<{ success?: boolean }>>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      !("error" in fetcher.data)
    ) {
      setOpen(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="p-2 text-red-600 hover:bg-red-50"
          title="Delete Group"
          aria-label={`Delete Group ${group.name}`}
          disabled={disabled}
        >
          <TrashIcon className="size-4" />
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="id" value={group.id} />
          <AlertDialogHeader>
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600 md:mx-0">
              <TrashIcon className="size-4" />
            </div>
            <AlertDialogTitle>Delete "{group.name}" group</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                <strong>Are you sure you want to delete this group?</strong>
              </p>
              <p>
                Deleting this group will NOT delete the custom fields inside it.
                Instead, all custom fields assigned to this group will lose
                their grouping and become ungrouped.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mt-6 flex">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              disabled={disabled}
            >
              {disabled ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Manage Custom Field Groups UI Component.
 */
export default function CustomFieldGroupsPage() {
  const { groups } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const validationErrors = getValidationErrors<typeof GroupActionSchema>(
    actionData?.error
  );
  const fetcher = useFetcher();
  const disabled = useDisabled();
  const reorderDisabled = useDisabled(fetcher);

  const handleMove = (index: number, direction: "up" | "down") => {
    const newGroups = [...groups];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newGroups.length) return;

    // Swap positions
    const temp = newGroups[index];
    newGroups[index] = newGroups[targetIndex];
    newGroups[targetIndex] = temp;

    const ids = newGroups.map((g) => g.id).join(",");
    void fetcher.submit(
      { intent: "reorder", groupIds: ids },
      { method: "post" }
    );
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
              {actionData?.error && !validationErrors && (
                <div className="text-sm text-error-500">
                  {actionData.error.message}
                </div>
              )}
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
                  disabled={disabled}
                  error={validationErrors?.name?.message}
                />
              </FormRow>
              <Button
                type="submit"
                variant="primary"
                className="w-full justify-center"
                disabled={disabled}
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
                        disabled={index === 0 || disabled || reorderDisabled}
                        onClick={() => handleMove(index, "up")}
                        title="Move Up"
                        aria-label="Move Up"
                        className="p-2"
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={
                          index === groups.length - 1 ||
                          disabled ||
                          reorderDisabled
                        }
                        onClick={() => handleMove(index, "down")}
                        title="Move Down"
                        aria-label="Move Down"
                        className="p-2"
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>

                      {/* Delete */}
                      <DeleteCustomFieldGroupDialog
                        group={group}
                        disabled={disabled || reorderDisabled}
                      />
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
