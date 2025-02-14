import type {
  Invite,
  Organization,
  Prisma,
  TeamMember,
  User,
} from "@prisma/client";
import { InviteStatuses } from "@prisma/client";
import type { AppLoadContext, LoaderFunctionArgs } from "@remix-run/node";
import jwt from "jsonwebtoken";
import lodash from "lodash";
import type { z } from "zod";
import type { InviteUserFormSchema } from "~/components/settings/invite-user-dialog";
import { db } from "~/database/db.server";
import { invitationTemplateString } from "~/emails/invite-template";
import { sendEmail } from "~/emails/mail.server";
import { organizationRolesMap } from "~/routes/_layout+/settings.team";
import { INVITE_EXPIRY_TTL_DAYS } from "~/utils/constants";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { INVITE_TOKEN_SECRET } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, isLikeShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { checkDomainSSOStatus, doesSSOUserExist } from "~/utils/sso.server";
import { generateRandomCode, inviteEmailText } from "./helpers";
import { createTeamMember } from "../team-member/service.server";
import { createUserOrAttachOrg } from "../user/service.server";

const label: ErrorLabel = "Invite";

/**
 * Validates invite based on SSO configuration, considering target organization
 * @param email - Email of the user being invited
 * @param organizationId - ID of the organization the user is being invited to
 * @throws ShelfError with appropriate message if invite is not allowed
 */
async function validateInvite(
  email: string,
  organizationId: string
): Promise<void> {
  const domainStatus = await checkDomainSSOStatus(email);

  // Case 1: Domain not configured for SSO - allow normal invite
  if (!domainStatus.isConfiguredForSSO) {
    return;
  }

  // Case 2: Check if the target organization is the one with SCIM. If it is, don't allow invite as the user needs to be managed via the IDP
  if (domainStatus.linkedOrganization?.id === organizationId) {
    throw new ShelfError({
      cause: null,
      message:
        "This email domain uses SCIM SSO for this workspace. Users are managed automatically through your identity provider.",
      label: "Invite",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  // Case 3: Domain configured for SSO but not linked to THIS org (Pure SSO)
  if (domainStatus.isConfiguredForSSO) {
    const ssoUserExists = await doesSSOUserExist(email);
    if (!ssoUserExists) {
      throw new ShelfError({
        cause: null,
        message:
          "This email domain uses SSO authentication. The user needs to sign up via SSO before they can be invited.",
        label: "Invite",
        status: 400,
        shouldBeCaptured: false,
      });
    }
  }
}

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
    extraMessage?: string | null;
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
    extraMessage,
  } = payload;

  try {
    // Add SSO validation before proceeding with invite
    await validateInvite(inviteeEmail, organizationId);

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

    sendEmail({
      to: inviteeEmail,
      subject: `✉️ You have been invited to ${invite.organization.name}`,
      text: inviteEmailText({ invite, token, extraMessage }),
      html: invitationTemplateString({ invite, token, extraMessage }),
    });

    return invite;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        cause instanceof ShelfError
          ? cause.message
          : "Something went wrong with creating your invite. Please try again. If the problem persists, please contact support",
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
      where: { id },
      include: { inviteeTeamMember: true },
    });

    if (!invite || invite.status !== InviteStatuses.PENDING) {
      let title = "Invite not found";
      let message =
        "The invitation you are trying to accept is either not found or expired";

      if (invite?.status === InviteStatuses.ACCEPTED) {
        title = "Invite already accepted";
        message =
          "Please login to your account to access the organization. \n If you have not set a password yet,\n you must use the <b>OTP login</b> the first time you access your account.";
      }

      if (invite?.status === InviteStatuses.REJECTED) {
        title = "Invite is rejected";
        message =
          "The invitation you are trying to accept is already rejected. If you think this is a mistake, please ask your administrator to send you a new invite.";
      }

      if (invite?.status === InviteStatuses.INVALIDATED) {
        title = "Invite is invalidated";
        message =
          "The invitation you are trying to accept is already invalidated. If you think this is a mistake, please ask your administrator to send you a new invite.";
      }

      if (invite?.expiresAt && invite.expiresAt < new Date()) {
        title = "Invite expired";
        message =
          "The invitation you are trying to accept is expired. Please ask your administrator to send you a new invite.";
      }

      throw new ShelfError({
        cause: null,
        message,
        title,
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
        createdWithInvite: true,
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
        data: {
          deletedAt: null,
          user: { connect: { id: user.id } },
          /**
           * This handles a special case.
           * If an invite is still pending, the team member is not yet linked to a user.
           * However the admin is allowed to assign bookings to that team member.
           * When the invite is accepted, we need to update all those bookings to also be linked to the user so they can see it on their bookings index.
           */
          bookings: {
            updateMany: {
              where: { custodianTeamMemberId: invite.teamMemberId },
              data: { custodianUserId: user.id },
            },
          },
        },
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
  invite,
}: {
  context: AppLoadContext;
  invite: Invite;
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

  if (user?.email !== invite?.inviteeEmail) {
    throw new ShelfError({
      cause: null,
      title: "Wrong user",
      message:
        "Your user's email doesn't match with the invited user so you cannot accept the invite. If you already have a user, make sure that you are logged in with the correct user. If the issue persists, feel free to contact support.",
      label: "Invite",
    });
  }
}

/** Gets invites for settings.team.invites page */
export async function getPaginatedAndFilterableSettingInvites({
  organizationId,
  request,
}: {
  organizationId: Organization["id"];
  request: LoaderFunctionArgs["request"];
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);

  const { page, perPageParam, search } = paramsValues;

  const inviteStatus =
    searchParams.get("inviteStatus") === "ALL"
      ? null
      : (searchParams.get("inviteStatus") as InviteStatuses);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    const inviteWhere: Prisma.InviteWhereInput = {
      organizationId,
      status: InviteStatuses.PENDING,
      inviteeEmail: { not: "" },
    };

    if (search) {
      /** Or search the input against input user/teamMember */
      inviteWhere.OR = [
        {
          inviteeTeamMember: {
            name: { contains: search, mode: "insensitive" },
          },
        },
        {
          inviteeUser: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    if (inviteStatus) {
      inviteWhere.status = inviteStatus;
    }

    const [invites, totalItemsGrouped] = await Promise.all([
      /** Get the invites */
      db.invite.findMany({
        where: inviteWhere,
        distinct: ["inviteeEmail"],
        skip,
        take,
        select: {
          id: true,
          teamMemberId: true,
          inviteeEmail: true,
          status: true,
          inviteeTeamMember: { select: { name: true } },
          roles: true,
        },
      }),

      db.invite.groupBy({
        by: ["inviteeEmail"],
        where: inviteWhere,
      }),
    ]);

    /**
     * Create the same structure for the invites
     */
    const items = invites.map((invite) => ({
      id: invite.id,
      name: invite.inviteeTeamMember.name,
      img: "/static/images/default_pfp.jpg",
      email: invite.inviteeEmail,
      status: invite.status,
      role: organizationRolesMap[invite?.roles[0]],
      userId: null,
      sso: false,
    }));
    const totalItems = totalItemsGrouped.length;
    const totalPages = Math.ceil(totalItems / perPage);

    return {
      page,
      perPage,
      totalPages,
      search,
      items,
      totalItems,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting registered users",
      additionalData: { organizationId },
      label,
    });
  }
}

type InviteUserSchema = z.infer<typeof InviteUserFormSchema>;

export async function bulkInviteUsers({
  users,
  userId,
  organizationId,
  extraMessage,
}: {
  users: Omit<InviteUserSchema, "teamMemberId">[];
  userId: User["id"];
  organizationId: Organization["id"];
  extraMessage?: string | null;
}) {
  try {
    // Filter out duplicate emails
    const uniquePayloads = lodash.uniqBy(users, (user) => user.email);

    // Batch validate all emails against SS
    await Promise.all(
      uniquePayloads.map((payload) =>
        validateInvite(payload.email, organizationId)
      )
    );

    // Batch check for existing users
    const emails = uniquePayloads.map((p) => p.email);
    const existingUsers = await db.user.findMany({
      where: {
        email: { in: emails },
        userOrganizations: {
          some: { organizationId },
        },
      },
      select: { email: true },
    });

    const existingEmailsInOrg = new Set(existingUsers.map((u) => u.email));

    // Batch check for existing invites in one query
    const existingInvites = await db.invite.findMany({
      where: {
        organizationId,
        inviteeEmail: { in: emails },
        status: InviteStatuses.PENDING,
        expiresAt: { gt: new Date() },
      },
      select: {
        inviteeEmail: true,
        inviteeTeamMember: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    /* All emails are already invited */
    if (existingInvites.length === emails.length) {
      sendNotification({
        title: "Users already invited",
        message:
          "All users in csv file are already invited to the organization.",
        icon: { name: "success", variant: "error" },
        senderId: userId,
      });

      return {
        inviteSentUsers: [],
        skippedUsers: users,
        extraMessage:
          "All users in csv file are already invited to the organization.",
      };
    }

    /* All emails are already in organization */
    if (existingUsers.length === emails.length) {
      sendNotification({
        title: "Users already member of organization",
        message: "All user in csv file are already part of your organization.",
        icon: { name: "success", variant: "error" },
        senderId: userId,
      });

      return {
        inviteSentUsers: [],
        skippedUsers: users,
        extraMessage:
          "All user in csv file are already part of your organization.",
      };
    }

    /* All emails are either in organization already or invited already */
    if (existingInvites.length + existingUsers.length === emails.length) {
      sendNotification({
        title: "0 users invited",
        message:
          "All users in file are either in organization or already invited.",
        icon: { name: "success", variant: "error" },
        senderId: userId,
      });

      return {
        inviteSentUsers: [],
        skippedUsers: users,
        extraMessage:
          "All users in file are either in organization or already invited.",
      };
    }

    const existingInviteEmails = existingInvites.map((i) => i.inviteeEmail);

    /**
     * We only have to send invite to the
     * - users who have not PENDING invitation and
     * - users who are not part of organization already
     */
    const validPayloads = uniquePayloads.filter(
      (p) =>
        !existingInviteEmails.includes(p.email) &&
        !existingEmailsInOrg.has(p.email)
    );

    const validPayloadsWithName = validPayloads.map((p) => ({
      ...p,
      name: p.email.split("@")[0],
    }));

    const createdTeamMembers = await db.teamMember.createManyAndReturn({
      data: validPayloadsWithName.map((p) => ({
        name: p.name,
        organizationId,
      })),
    });

    // Prepare invite data
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_TTL_DAYS);

    const invitesToCreate = validPayloadsWithName.map((payload) => ({
      inviterId: userId,
      organizationId,
      inviteeEmail: payload.email,
      teamMemberId:
        createdTeamMembers.find((tm) => tm.name === payload.name)?.id ?? "",
      roles: [payload.role],
      expiresAt,
      inviteCode: generateRandomCode(6),
      status: InviteStatuses.PENDING,
    }));

    // Bulk create invites
    const createdInvites = await db.invite.createManyAndReturn({
      data: invitesToCreate,
      include: {
        inviter: { select: { firstName: true, lastName: true } },
        organization: true,
      },
    });

    // Queue emails for sending - no need to await since it's handled by queue
    createdInvites.forEach((invite) => {
      const token = jwt.sign({ id: invite.id }, INVITE_TOKEN_SECRET, {
        expiresIn: `${INVITE_EXPIRY_TTL_DAYS}d`,
      });

      sendEmail({
        to: invite.inviteeEmail,
        subject: `✉️ You have been invited to ${invite.organization.name}`,
        text: inviteEmailText({ invite, token, extraMessage }),
        html: invitationTemplateString({ invite, token, extraMessage }),
      });
    });

    sendNotification({
      title: "Successfully invited users",
      message: `${createdInvites.length} user(s) have been invited successfully. They will receive an email in which they can complete their registration.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    const skippedUsers = users.filter(
      (user) =>
        existingInviteEmails.includes(user.email) ||
        existingEmailsInOrg.has(user.email)
    );

    return {
      inviteSentUsers: validPayloads,
      skippedUsers,
      extraMessage:
        createdInvites.length > 10
          ? "You are sending more than 10 invites, so some of the emails might get slightly delayed. If one of the invitees hasnt received the email within 5-10 minutes, you can use the Resend invite feature to send the email again."
          : undefined,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while inviting users.",
      label,
      additionalData: { users },
    });
  }
}
