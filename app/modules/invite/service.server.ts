import type { Invite } from "@prisma/client";
import { InviteStatuses } from "@prisma/client";
import jwt from "jsonwebtoken";
import { db } from "~/database";
import { INVITE_TOKEN_SECRET, SERVER_URL } from "~/utils";
import { INVITE_EXPIRY_TTL_DAYS } from "~/utils/constants";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { generateRandomCode } from "./helpers";
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
}: Pick<Invite, "inviterId" | "inviteeEmail" | "organizationId" | "roles">) {
  const activeInvite = await getExisitingActiveInvite({
    organizationId,
    inviteeEmail,
  });
  if (activeInvite) {
    throw new ShelfStackError({
      message: `user ${inviteeEmail} has already been invited to the current organization`,
      status: 400,
      title: `Invalid invite attempt`,
    });
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

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_TTL_DAYS);
  const data = {
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
    },
  });

  const token = jwt.sign(invite, INVITE_TOKEN_SECRET);
  await sendEmail({
    to: inviteeEmail,
    subject: `You have been invited to ${invite.organization.name}`,
    text: `click to accept ${SERVER_URL}/invite-respond?token=${token}`, //TODO change path if needed
  }); //TODO: user template and embed token as part of button url
  return invite;
}

//when user clicks on accept/reject route action will validate the jwt if its valid it will call this
export async function updateInviteStatus({
  id,
  status,
}: Pick<Invite, "id" | "status">) {
  const invite = await db.invite.findFirst({
    where: {
      id,
      status: InviteStatuses.PENDING,
      expiresAt: { lte: new Date() },
    },
  });
  if (!invite) {
    throw new ShelfStackError({
      message: `invite with id ${id} not found or expired`,
      title: "invite not found",
      status: 404,
    });
  }
  if (status === "ACCEPTED") {
    const data = { status };
    if (invite.roles.find((r) => r === "TEAM_MEMBER")) {
      const teamMember = await createTeamMember({
        name: invite.inviteeEmail,
        organizationId: invite.organizationId,
      });
      Object.assign(data, {
        inviteeTeamMember: {
          connect: {
            id: teamMember.id,
          },
        },
      });
    } else {
      const user = await createUserOrAttachOrg({
        email: invite.inviteeEmail,
        organizationId: invite.organizationId,
      });
      Object.assign(data, {
        inviteeUser: {
          connect: {
            id: user.id,
          },
        },
      });
    }
    await db.invite.update({ where: { id }, data });
  } else {
    await db.invite.update({
      where: { id },
      data: {
        status,
      },
    });
  }
}
