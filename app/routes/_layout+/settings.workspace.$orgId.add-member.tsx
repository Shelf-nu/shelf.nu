import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import Input from "~/components/forms/input";
import { UserIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import styles from "~/styles/layout/custom-modal.css";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export const loader = async ({ request }: LoaderArgs) => {
  await requireAuthSession(request);

  return json({
    showModal: true,
  });
};

export const action = async ({ request, params }: ActionArgs) => {
  const { userId } = await requireAuthSession(request);
  const formData = await request.formData();
  const orgId = params.orgId as string;

  const teamMember = await db.teamMember.create({
    data: {
      name: formData.get("name") as string,
      organizations: {
        connect: {
          id: orgId,
        },
      },
    },
  });

  if (!teamMember)
    return json({ error: "Something went wrong. Please try again." });

  sendNotification({
    title: "Successfully added a new team member",
    message: "You are now able to give this team member custody over assets.",
    icon: { name: "success", variant: "success" },
    senderId: userId,
  });

  return redirect(`/settings/workspace`);
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function AddMember() {
  const actionData = useActionData<typeof action>();
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex h-8 w-8 items-center  justify-center rounded-full bg-primary-100 p-2 text-primary-600">
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
          <Button variant="primary" width="full" type="submit">
            Add team member
          </Button>
        </Form>
        {actionData?.error && (
          <div className="text-sm text-error-500">{actionData.error}</div>
        )}
      </div>
    </>
  );
}
