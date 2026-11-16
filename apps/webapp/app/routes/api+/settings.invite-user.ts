/**
 * Invite User API
 *
 * Handles the "Invite a user" dialog on the team settings page: sends one
 * invite to one email address.
 *
 * @see {@link file://./../../components/settings/invite-user-dialog.tsx}
 * @see {@link file://./../../modules/invite/service.server.ts}
 */
import { data, type ActionFunctionArgs } from "react-router";
import { InviteUserFormSchema } from "~/components/settings/invite-user-dialog";
import { db } from "~/database/db.server";
import { createInvite } from "~/modules/invite/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

/**
 * Sends a workspace invite to one email address.
 *
 * An earlier pending invite to the same address (in any letter case) does not
 * block it: `createInvite` invalidates the earlier one, so only the newest
 * invite can be accepted.
 *
 * @returns `{ success: true }` when an invite was sent, `null` payload when
 *   `createInvite` declined it (it notifies the sender why), or an error
 *   payload with its status
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    await assertUserCanInviteUsersToWorkspace({ organizationId });

    const { email, teamMemberId, role, inviteMessage } = parseData(
      await request.formData(),
      InviteUserFormSchema
    );

    let teamMemberName = email.split("@")[0];

    if (teamMemberId) {
      const teamMember = await db.teamMember
        .findUnique({
          where: { deletedAt: null, id: teamMemberId, organizationId },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to get team member",
            additionalData: { teamMemberId, userId },
            label: "Team",
          });
        });

      if (teamMember) {
        teamMemberName = teamMember.name;
      }
    }

    // An earlier pending invite to this email does not block a new one:
    // createInvite invalidates it in the same transaction that creates this one.
    const invite = await createInvite({
      organizationId,
      inviteeEmail: email,
      inviterId: userId,
      roles: [role],
      teamMemberName,
      teamMemberId,
      userId,
      extraMessage: inviteMessage,
      // Only the workspace owner may grant an owner-only role; createInvite enforces it.
      actorOwnsWorkspace: access.ownsWorkspace,
    });

    if (!invite) {
      return data(payload(null));
    }

    sendNotification({
      title: "Successfully invited user",
      message:
        "They will receive an email in which they can complete their registration.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
