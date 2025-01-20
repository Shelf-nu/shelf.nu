import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  json,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { NewOrEditMemberSchema } from "./settings.team.nrm.add-member";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { nrmId } = getParams(params, z.object({ nrmId: z.string() }), {
    additionalData: { userId },
  });

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.update,
    });

    const teamMember = await getTeamMember({ id: nrmId });

    return json(data({ showModal: true, teamMember }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, nrmId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { nrmId } = getParams(params, z.object({ nrmId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.update,
    });

    const { name } = parseData(await request.formData(), NewOrEditMemberSchema);

    await db.teamMember.update({
      where: { id: nrmId, organizationId },
      data: { name: name.trim() },
    });

    sendNotification({
      title: "Success",
      icon: { name: "success", variant: "success" },
      senderId: userId,
      message: "Name of team member is edited successfully",
    });

    return redirect("/settings/team/nrm");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, nrmId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function EditNrm() {
  const zo = useZorm("EditMember", NewOrEditMemberSchema);

  const { teamMember } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <div className="modal-content-wrapper">
      <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
        <UserIcon />
      </div>

      <h4 className="mb-5">Edit team member</h4>

      <Form method="post" ref={zo.ref}>
        <Input
          defaultValue={teamMember.name}
          name={zo.fields.name()}
          type="text"
          label="Name"
          className="mb-8"
          placeholder="Enter team member’s name"
          required
          autoFocus
          error={zo.errors.name()?.message}
          disabled={disabled}
        />
        <Button
          variant="primary"
          width="full"
          type="submit"
          disabled={disabled}
        >
          Save
        </Button>
      </Form>
      {actionData?.error && (
        <div className="text-sm text-error-500">{actionData.error.message}</div>
      )}
    </div>
  );
}
