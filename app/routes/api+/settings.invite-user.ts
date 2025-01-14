import { json, type ActionFunctionArgs } from "@remix-run/node";
import { InviteUserFormSchema } from "~/components/settings/invite-user-dialog";
import { db } from "~/database/db.server";
import { createInvite } from "~/modules/invite/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

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

    await assertUserCanInviteUsersToWorkspace({ organizationId });

    const { email, teamMemberId, role } = parseData(
      await request.formData(),
      InviteUserFormSchema
    );

    let teamMemberName = email.split("@")[0];

    if (teamMemberId) {
      const teamMember = await db.teamMember
        .findUnique({
          where: { deletedAt: null, id: teamMemberId },
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

    const existingInvites = await db.invite.findMany({
      where: {
        status: "PENDING",
        inviteeEmail: email,
        organizationId,
      },
    });

    if (existingInvites.length) {
      throw new ShelfError({
        cause: null,
        message:
          "User already has a pending invite. Either resend it or cancel it in order to be able to send a new one.",
        additionalData: { email, organizationId },
        label: "Invite",
        shouldBeCaptured: false,
      });
    }

    const invite = await createInvite({
      organizationId,
      inviteeEmail: email,
      inviterId: userId,
      roles: [role],
      teamMemberName,
      teamMemberId,
      userId,
    });

    if (!invite) {
      return json(data(null));
    }

    sendNotification({
      title: "Successfully invited user",
      message:
        "They will receive an email in which they can complete their registration.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
