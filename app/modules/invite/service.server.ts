import type { Invite, TeamMember } from "@prisma/client";
import { InviteStatuses } from "@prisma/client";
import type { AppLoadContext } from "@remix-run/node";
import type { Params } from "@remix-run/react";
import jwt from "jsonwebtoken";
import { db } from "~/database/db.server";
import { invitationTemplateString } from "~/emails/invite-template";
import { INVITE_EXPIRY_TTL_DAYS } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { INVITE_TOKEN_SECRET } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, isLikeShelfError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { generateRandomCode, inviteEmailText } from "./helpers";
import { createTeamMember } from "../team-member/service.server";
import { createUserOrAttachOrg } from "../user/service.server";

const label: ErrorLabel = "Invite";

//can be used in ui when user enters email so that we can tell invitee is already invited
export async function getExistingActiveInvite({
  organizationId,
  inviteeEmail,
}: Pick<Invite, "inviteeEmail" | "organizationId">) {
  try {
    return await db.invite.findFirst({
      where: {
        organizationId,
        inviteeEmail,
        OR: [
          //invite is either not rejected or not expired
          {
            status: { notIn: ["REJECTED"] }, //should we allow reinvite if user rejects?
          },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong with fetching existing invite. Please try again or contact support.",
      additionalData: { organizationId, inviteeEmail },
      label,
    });
  }
}
export async function createInvite(
  payload: Pick<
    Invite,
    "inviterId" | "inviteeEmail" | "organizationId" | "roles"
  > & {
    teamMemberName: TeamMember["name"];
    teamMemberId?: Invite["teamMemberId"];
    userId: string;
  }
) {
  let {
    organizationId,
    inviteeEmail,
    inviterId,
    roles,
    teamMemberName,
    teamMemberId,
    userId,
  } = payload;

  try {
    const existingUser = await db.user.findFirst({
      where: {
        email: inviteeEmail,
        userOrganizations: {
          some: { organizationId },
        },
      },
    });

    if (existingUser) {
      //if email is already part of organization, we dont allow new invite
      sendNotification({
        title: `Cannot invite user ${inviteeEmail}`,
        message:
          "There is a user with same email already part of the organization",
        icon: { name: "x", variant: "error" },
        senderId: userId,
      });

      return null;
    }

    if (!teamMemberId) {
      const previousInvite = await db.invite.findFirst({
        where: {
          organizationId,
          inviteeEmail,
        },
      });

      if (previousInvite?.teamMemberId) {
        //we already invited this user before, so dont create 1 more team member
        teamMemberId = previousInvite.teamMemberId;
      } else {
        const member = await createTeamMember({
          name: teamMemberName,
          organizationId,
        });

        teamMemberId = member.id;
      }
    } else {
      const previousActiveInvite = await db.invite.findFirst({
        where: {
          organizationId,
          inviteeEmail,
          status: InviteStatuses.PENDING,
          expiresAt: { gt: new Date() },
        },
      });

      if (
        previousActiveInvite &&
        previousActiveInvite.teamMemberId !== teamMemberId
      ) {
        //there is already an active invite for different team member, so dont allow new invite
        sendNotification({
          title: `Cannot invite user ${inviteeEmail}`,
          message:
            "There is an active invite for this user linked to different NRM",
          icon: { name: "x", variant: "error" },
          senderId: userId,
        });

        return null;
      }
    }

    const inviter = {
      connect: {
        id: inviterId,
      },
    };

    const organization = {
      connect: {
        id: organizationId,
      },
    };

    const inviteeTeamMember = {
      connect: {
        id: teamMemberId,
      },
    };

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_TTL_DAYS);

    const data = {
      inviteeTeamMember,
      organization,
      inviter,
      inviteeEmail,
      expiresAt,
      inviteCode: generateRandomCode(6),
    };

    if (roles.length) {
      Object.assign(data, {
        roles,
      });
    }

    const invite = await db.invite
      .create({
        data,
        include: {
          organization: true,
          inviter: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to create invite in database",
          additionalData: { data },
          label,
        });
      });

    const token = jwt.sign({ id: invite.id }, INVITE_TOKEN_SECRET, {
      expiresIn: `${INVITE_EXPIRY_TTL_DAYS}d`,
    }); //keep only needed data in token to maintain the size

    await sendEmail({
      to: inviteeEmail,
      subject: `You have been invited to ${invite.organization.name}`,
      text: inviteEmailText({ invite, token }),
      html: invitationTemplateString({ invite, token }),
    });

    return invite;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong with creating your invite. Please try again. If the problem persists, please contact support",
      additionalData: { payload },
      label,
    });
  }
}

//when user clicks on accept/reject route action will validate the jwt if its valid it will call this
export async function updateInviteStatus({
  id,
  status,
  password,
}: Pick<Invite, "id" | "status"> & { password: string }) {
  try {
    const invite = await db.invite.findFirst({
      where: {
        id,
        status: InviteStatuses.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: {
        inviteeTeamMember: true,
      },
    });

    if (!invite) {
      throw new ShelfError({
        cause: null,
        message:
          "The invitation you are trying to accept is either not found or expired",
        title: "Invite not found",
        label,
      });
    }

    const data = { status };

    if (status === "ACCEPTED") {
      const user = await createUserOrAttachOrg({
        email: invite.inviteeEmail,
        organizationId: invite.organizationId,
        roles: invite.roles,
        password,
        firstName: invite.inviteeTeamMember.name,
      });

      Object.assign(data, {
        inviteeUser: {
          connect: {
            id: user.id,
          },
        },
      });

      await db.teamMember.update({
        where: { id: invite.teamMemberId },
        data: { deletedAt: null, user: { connect: { id: user.id } } },
      });
    }

    const updatedInvite = await db.invite.update({ where: { id }, data });

    //admin might have sent multiple invites(due to email spam or network issue, or just for fun etc) so we invalidate all of them if user rejects 1
    //because user doesnt or want to join that org, so we should update all pending invite to show the same
    await db.invite.updateMany({
      where: {
        status: InviteStatuses.PENDING,
        inviteeEmail: invite.inviteeEmail,
        organizationId: invite.organizationId,
      },
      data: { status: InviteStatuses.INVALIDATED },
    });

    return updatedInvite;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong with updating your invite. Please try again",
      additionalData: { id, status },
      label,
    });
  }
}

/**
 * Checks if the user is already signed in and if the invite is for the same user
 */
export async function checkUserAndInviteMatch({
  context,
  params,
}: {
  context: AppLoadContext;
  params: Params<string>;
}) {
  const authSession = context.getSession();
  const { userId } = authSession;

  /** We get the user, selecting only the email */
  const user = await db.user
    .findFirst({
      where: {
        id: userId,
      },
      select: {
        email: true,
      },
    })
    .catch(() => null);

  /** We get the invite based on the id of the params */
  const inv = await db.invite
    .findFirst({
      where: {
        id: params.inviteId,
      },
    })
    .catch(() => null);

  if (user?.email !== inv?.inviteeEmail) {
    throw new ShelfError({
      cause: null,
      title: "Wrong user",
      message:
        "Your user's email doesn't match with the invited user so you cannot accept the invite. If you already have a user, make sure that you are logged in with the correct user. If the issue persists, feel free to contact support.",
      label: "Invite",
    });
  }
}
