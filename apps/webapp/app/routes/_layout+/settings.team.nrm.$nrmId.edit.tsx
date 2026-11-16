import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { UserIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { getNrmForEdit, renameNrm } from "~/modules/team-member/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { NewOrEditMemberSchema } from "./settings.team.nrm.add-member";

/**
 * Loads a non-registered member for the edit modal.
 *
 * Gated on `nonRegisteredMember:update` and read through the NRM scope, so an
 * id that is not an NRM of the workspace answers 404.
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { nrmId } = getParams(params, z.object({ nrmId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.nonRegisteredMember,
      action: PermissionAction.update,
    });

    const teamMember = await getNrmForEdit({ nrmId, organizationId });

    return payload({ showModal: true, teamMember });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, nrmId });
    throw data(error(reason), { status: reason.status });
  }
}
export const meta = () => [{ title: appendToMetaTitle("Edit team member") }];

/**
 * Renames a non-registered member.
 *
 * Carries its own `nonRegisteredMember:update` gate (a direct POST never runs
 * the loader) and writes through the scoped rename.
 */
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
      entity: PermissionEntity.nonRegisteredMember,
      action: PermissionAction.update,
    });

    const { name } = parseData(await request.formData(), NewOrEditMemberSchema);

    // The scope is part of the write: only a row the NRM index lists can be
    // renamed, never a registered member's stored display name.
    await renameNrm({ nrmId, organizationId, name: name.trim() });

    sendNotification({
      title: "Success",
      icon: { name: "success", variant: "success" },
      senderId: userId,
      message: "Name of team member is edited successfully",
    });

    return redirect("/settings/team/nrm");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, nrmId });
    return data(error(reason), { status: reason.status });
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

  /** Focus the name field when the modal route mounts (replaces autoFocus). */
  const nameInputRef = useAutoFocus<HTMLInputElement>();

  return (
    <div className="modal-content-wrapper">
      <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
        <UserIcon />
      </div>

      <h4 className="mb-5">Edit team member</h4>

      <Form method="post" ref={zo.ref}>
        <Input
          ref={nameInputRef}
          defaultValue={teamMember.name}
          name={zo.fields.name()}
          type="text"
          label="Name"
          className="mb-8"
          placeholder="Enter team member’s name"
          required
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
