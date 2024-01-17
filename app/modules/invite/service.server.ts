import type { Invite, TeamMember } from "@prisma/client";
import { InviteStatuses } from "@prisma/client";
import jwt from "jsonwebtoken";
import { db } from "~/database";
import { INVITE_TOKEN_SECRET } from "~/utils";
import { INVITE_EXPIRY_TTL_DAYS } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { generateRandomCode, inviteEmailText } from "./helpers";
import { createTeamMember } from "../team-member";
import { createUserOrAttachOrg } from "../user";

//can be used in ui when user enters email so that we can tell invitee is already invited
export async function getExisitingActiveInvite({
  organizationId,
  inviteeEmail,
}: Pick<Invite, "inviteeEmail" | "organizationId">) {
  return db.invite.findFirst({
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
}
export async function createInvite({
  organizationId,
  inviteeEmail,
  inviterId,
  roles,
  teamMemberName,
  teamMemberId,
  userId,
}: Pick<Invite, "inviterId" | "inviteeEmail" | "organizationId" | "roles"> & {
  teamMemberName: TeamMember["name"];
  teamMemberId?: Invite["teamMemberId"];
  userId: string;
}) {
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
      //there is already an active invite for different team member, so dont allow new invte
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
  const invite = await db.invite.create({
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
  });

  const token = jwt.sign({ id: invite.id }, INVITE_TOKEN_SECRET, {
    expiresIn: `${INVITE_EXPIRY_TTL_DAYS}d`,
  }); //keep only needed data in token to maintain the size
  await sendEmail({
    to: inviteeEmail,
    subject: `You have been invited to ${invite.organization.name}`,
    text: inviteEmailText({ invite, token }),
  });

  return invite;
}

//when user clicks on accept/reject route action will validate the jwt if its valid it will call this
export async function updateInviteStatus({
  id,
  status,
  password,
}: Pick<Invite, "id" | "status"> & { password: string }) {
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
    throw new ShelfStackError({
      message: `invite with id ${id} not found or expired`,
      title: "invite not found",
      status: 404,
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

    if (!user) {
      throw new ShelfStackError({
        message: `There was an issue with creating/attaching user with email: ${invite.inviteeEmail}`,
        status: 401,
      });
    }
    Object.assign(data, {
      inviteeUser: {
        connect: {
          id: user.id,
        },
      },
    });
    await db.teamMember.update({
      where: { id: invite.teamMemberId },
      data: { user: { connect: { id: user.id } } },
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
}
