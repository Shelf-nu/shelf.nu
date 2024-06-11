import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
import { Form } from "~/components/custom-form";
import { z } from "zod";
import Input from "~/components/forms/input";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, maybeUniqueConstraintViolation } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    return json(
      data({
        showModal: true,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    const payload = parseData(
      await request.formData(),
      z.object({ name: z.string() })
    );

    const { name } = payload;

    await db.teamMember
      .create({
        data: {
          name: name.trim(),
          organizationId,
        },
      })
      .catch((cause) => {
        throw maybeUniqueConstraintViolation(cause, "Team Member", {
          additionalData: { userId, name },
        });
      });

    sendNotification({
      title: "Successfully added a new team member",
      message: "You are now able to give this team member custody over assets.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/settings/team`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function AddMember() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
          <UserIcon color="#ef6820" />
        </div>
        <div className="mb-5">
          <h4>Add team member</h4>
          <p>
            Team members are added to your environment but do not have an
            account to log in with.
          </p>
        </div>
        <Form method="post">
          <Input
            name="name"
            type="text"
            label="Name"
            className="mb-8"
            placeholder="Enter team member’s name"
            required
            autoFocus
          />
          <Button
            variant="primary"
            width="full"
            type="submit"
            disabled={disabled}
          >
            Add team member
          </Button>
        </Form>
        {actionData?.error && (
          <div className="text-sm text-error-500">
            {actionData.error.message}
          </div>
        )}
      </div>
    </>
  );
}
