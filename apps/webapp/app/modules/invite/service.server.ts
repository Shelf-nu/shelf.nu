import type { Invite, Organization, TeamMember, User } from "@prisma/client";
import { InviteStatuses, OrganizationRoles } from "@prisma/client";
import type { Sb } from "@shelf/database";

import jwt from "jsonwebtoken";
import lodash from "lodash";
import type { AppLoadContext, LoaderFunctionArgs } from "react-router";
import invariant from "tiny-invariant";
import type { z } from "zod";
import type { InviteUserFormSchema } from "~/components/settings/invite-user-dialog";
import { sbDb } from "~/database/supabase.server";
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
import { generateRandomCode, inviteEmailText, splitName } from "./helpers";
import { processInvitationMessage } from "./message-validator.server";
import type { InviteWithInviterAndOrg } from "./types";
import { createTeamMember } from "../team-member/service.server";
import { createUserOrAttachOrg } from "../user/service.server";

const label: ErrorLabel = "Invite";

const INVITE_EMAIL_BATCH_SIZE = 20;
const INVITE_EMAIL_BATCH_DELAY_MS = 1_000;
const INVITE_EMAIL_SPACING_MS = Math.ceil(
  INVITE_EMAIL_BATCH_DELAY_MS / INVITE_EMAIL_BATCH_SIZE
);

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
          "This email domain uses SSO authentication. The user needs to sign up via SSO to get access to the organization.",
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
    const { data, error } = await sbDb
      .from("Invite")
      .select()
      .eq("organizationId", organizationId)
      .eq("inviteeEmail", inviteeEmail)
      .or(`status.neq.REJECTED,expiresAt.gt.${new Date().toISOString()}`)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return data;
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

    // Validate and sanitize invitation message
    const messageResult = processInvitationMessage(extraMessage);
    if (!messageResult.success) {
      throw new ShelfError({
        cause: null,
        message: messageResult.error || "The invitation message is invalid",
        additionalData: { userId, organizationId },
        label: "Invite",
        shouldBeCaptured: false,
      });
    }
    const sanitizedMessage = messageResult.message;

    // Check if user with this email is already part of the organization
    const { data: existingUserData, error: existingUserError } = await sbDb
      .from("User")
      .select("id")
      .eq("email", inviteeEmail)
      .limit(1)
      .maybeSingle();

    if (existingUserError) throw existingUserError;

    if (existingUserData) {
      // Check if user is already part of the organization
      const { data: userOrgData, error: userOrgError } = await sbDb
        .from("UserOrganization")
        .select("userId")
        .eq("userId", existingUserData.id)
        .eq("organizationId", organizationId)
        .limit(1)
        .maybeSingle();

      if (userOrgError) throw userOrgError;

      if (userOrgData) {
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
    }

    if (!teamMemberId) {
      const { data: previousInvite, error: prevInviteError } = await sbDb
        .from("Invite")
        .select("*")
        .eq("organizationId", organizationId)
        .eq("inviteeEmail", inviteeEmail)
        .limit(1)
        .maybeSingle();

      if (prevInviteError) throw prevInviteError;

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
      const { data: previousActiveInvite, error: prevActiveError } = await sbDb
        .from("Invite")
        .select("*")
        .eq("organizationId", organizationId)
        .eq("inviteeEmail", inviteeEmail)
        .eq("status", InviteStatuses.PENDING)
        .gt("expiresAt", new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (prevActiveError) throw prevActiveError;

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

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_TTL_DAYS);

    const inviteData: Sb.InviteInsert = {
      teamMemberId: teamMemberId!,
      organizationId,
      inviterId,
      inviteeEmail,
      expiresAt: expiresAt.toISOString(),
      inviteCode: generateRandomCode(6),
      ...(sanitizedMessage && { inviteMessage: sanitizedMessage }),
      ...(roles.length && { roles }),
    };

    const { data: createdInvite, error: createError } = await sbDb
      .from("Invite")
      .insert(inviteData)
      .select("*")
      .single();

    if (createError) {
      throw new ShelfError({
        cause: createError,
        message: "Failed to create invite in database",
        additionalData: { inviteData },
        label,
      });
    }

    // Fetch inviter and organization separately (Relationships not typed)
    const [inviterResult, orgResult] = await Promise.all([
      sbDb
        .from("User")
        .select("firstName, lastName")
        .eq("id", createdInvite.inviterId)
        .single(),
      sbDb
        .from("Organization")
        .select("*")
        .eq("id", createdInvite.organizationId)
        .single(),
    ]);

    if (inviterResult.error) throw inviterResult.error;
    if (orgResult.error) throw orgResult.error;

    const invite: InviteWithInviterAndOrg = {
      ...createdInvite,
      inviter: inviterResult.data,
      organization: orgResult.data,
    };

    const token = jwt.sign({ id: invite.id }, INVITE_TOKEN_SECRET, {
      expiresIn: `${INVITE_EXPIRY_TTL_DAYS}d`,
    }); //keep only needed data in token to maintain the size

    sendEmail({
      to: inviteeEmail,
      subject: `\u2709\uFE0F You have been invited to ${invite.organization.name}`,
      text: inviteEmailText({ invite, token, extraMessage: sanitizedMessage }),
      html: await invitationTemplateString({
        invite,
        token,
        extraMessage: sanitizedMessage,
      }),
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
    const { data: invite, error: findError } = await sbDb
      .from("Invite")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;

    if (!invite || invite.status !== InviteStatuses.PENDING) {
      let title = "Invite not found";
      let message =
        "The invitation you are trying to accept is either not found or expired";

      if (invite?.status === InviteStatuses.ACCEPTED) {
        title = "Invite already accepted";
        message =
          "Please login to your account to access the organization. <br/> If you have not set a password yet, you must use the <b>OTP login</b> the first time you access your account.";
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

      if (invite?.expiresAt && new Date(invite.expiresAt) < new Date()) {
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

    const updateData: Record<string, unknown> = { status };

    if (status === "ACCEPTED") {
      // Fetch the team member separately
      const { data: inviteeTeamMember, error: tmFindError } = await sbDb
        .from("TeamMember")
        .select("*")
        .eq("id", invite.teamMemberId)
        .single();

      if (tmFindError) throw tmFindError;

      const { firstName, lastName } = splitName(inviteeTeamMember.name);

      const user = await createUserOrAttachOrg({
        email: invite.inviteeEmail,
        organizationId: invite.organizationId,
        roles: invite.roles,
        password,
        firstName,
        lastName,
        createdWithInvite: true,
      });

      updateData.inviteeUserId = user.id;

      // Update team member: link to user and clear deletedAt
      const { error: tmUpdateError } = await sbDb
        .from("TeamMember")
        .update({ deletedAt: null, userId: user.id })
        .eq("id", invite.teamMemberId);

      if (tmUpdateError) throw tmUpdateError;

      // Update bookings assigned to this team member to also link to the user
      const { error: bookingUpdateError } = await sbDb
        .from("Booking")
        .update({ custodianUserId: user.id })
        .eq("custodianTeamMemberId", invite.teamMemberId);

      if (bookingUpdateError) throw bookingUpdateError;
    }

    const { data: updatedInvite, error: updateError } = await sbDb
      .from("Invite")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    //admin might have sent multiple invites(due to email spam or network issue, or just for fun etc) so we invalidate all of them if user rejects 1
    //because user doesnt or want to join that org, so we should update all pending invite to show the same
    const { error: invalidateError } = await sbDb
      .from("Invite")
      .update({ status: InviteStatuses.INVALIDATED })
      .eq("status", InviteStatuses.PENDING)
      .eq("inviteeEmail", invite.inviteeEmail)
      .eq("organizationId", invite.organizationId);

    if (invalidateError) throw invalidateError;

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
  const { data: user } = await sbDb
    .from("User")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

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

    const statusFilter = inviteStatus || InviteStatuses.PENDING;

    // Build the query for invites
    const { data: allInvites, error: allError } = await sbDb
      .from("Invite")
      .select("id, teamMemberId, inviteeEmail, status, roles, inviteMessage")
      .eq("organizationId", organizationId)
      .eq("status", statusFilter)
      .neq("inviteeEmail", "");

    if (allError) throw allError;

    // Deduplicate by inviteeEmail (equivalent to Prisma's distinct)
    const seenEmails = new Set<string>();
    const uniqueInvites = (allInvites || []).filter((invite) => {
      if (seenEmails.has(invite.inviteeEmail)) {
        return false;
      }
      seenEmails.add(invite.inviteeEmail);
      return true;
    });

    // Fetch team member names for unique team member IDs
    const uniqueTeamMemberIds = [
      ...new Set(uniqueInvites.map((i) => i.teamMemberId)),
    ];
    const { data: teamMembersData, error: tmError } = await sbDb
      .from("TeamMember")
      .select("id, name")
      .in("id", uniqueTeamMemberIds);

    if (tmError) throw tmError;

    const teamMemberMap = new Map(
      (teamMembersData || []).map((tm) => [tm.id, tm.name])
    );

    // Build enriched invites with team member names
    const enrichedInvites = uniqueInvites.map((invite) => ({
      ...invite,
      teamMemberName: teamMemberMap.get(invite.teamMemberId) ?? "",
    }));

    // Filter by search if provided
    let filteredInvites = enrichedInvites;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredInvites = enrichedInvites.filter(
        (invite) =>
          invite.inviteeEmail.toLowerCase().includes(lowerSearch) ||
          invite.teamMemberName.toLowerCase().includes(lowerSearch)
      );
    }

    const totalItems = filteredInvites.length;
    const paginatedInvites = filteredInvites.slice(skip, skip + take);

    /**
     * Create the same structure for the invites
     */
    const items = paginatedInvites.map((invite) => {
      const roleEnum = invite.roles[0] ?? OrganizationRoles.BASE;
      return {
        id: invite.id,
        name: invite.teamMemberName,
        img: "/static/images/default_pfp.jpg",
        email: invite.inviteeEmail,
        status: invite.status,
        role: organizationRolesMap[roleEnum],
        roleEnum,
        userId: null,
        sso: false,
        inviteMessage: invite.inviteMessage,
      };
    });

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
  users: InviteUserSchema[];
  userId: User["id"];
  organizationId: Organization["id"];
  extraMessage?: string | null;
}) {
  try {
    // Validate and sanitize invitation message
    const messageResult = processInvitationMessage(extraMessage);
    if (!messageResult.success) {
      sendNotification({
        title: "Invalid invitation message",
        message: messageResult.error || "The invitation message is invalid",
        icon: { name: "x", variant: "error" },
        senderId: userId,
      });
      throw new ShelfError({
        cause: null,
        message: messageResult.error || "Invalid invitation message",
        additionalData: { extraMessage },
        label,
      });
    }
    const sanitizedMessage = messageResult.message;

    // Filter out entries with missing or invalid email/role
    const validUsers = users.filter(
      (user) =>
        user.email &&
        user.role &&
        user.email.trim() !== "" &&
        user.role.trim() !== ""
    );

    // Filter out duplicate emails
    const uniquePayloads = lodash.uniqBy(validUsers, (user) => user.email);

    // Batch validate all emails against SS
    await Promise.all(
      uniquePayloads.map((payload) =>
        validateInvite(payload.email, organizationId)
      )
    );

    const teamMemberIds = uniquePayloads
      .filter((user) => !!user.teamMemberId)
      .map((user) => user.teamMemberId!);

    const { data: teamMembers, error: tmError } = await sbDb
      .from("TeamMember")
      .select("id, userId")
      .in("id", teamMemberIds)
      .eq("organizationId", organizationId);

    if (tmError) throw tmError;

    /**
     * These teamMembers has a user already associated.
     * So we will skip them from the invite process.
     * */
    const teamMembersWithUserId = (teamMembers || [])
      .filter((tm) => !!tm.userId)
      .map((tm) => tm.id!);

    // Batch check for existing users in the organization
    const emails = uniquePayloads.map((p) => p.email);

    // First find users by email
    const { data: usersWithEmail, error: usersError } = await sbDb
      .from("User")
      .select("id, email")
      .in("email", emails);

    if (usersError) throw usersError;

    // Then check which of those users are in the organization
    const userIdsWithEmail = (usersWithEmail || []).map((u) => u.id);
    let existingUsersInOrg: { userId: string }[] = [];
    if (userIdsWithEmail.length > 0) {
      const { data: userOrgs, error: userOrgsError } = await sbDb
        .from("UserOrganization")
        .select("userId")
        .in("userId", userIdsWithEmail)
        .eq("organizationId", organizationId);

      if (userOrgsError) throw userOrgsError;
      existingUsersInOrg = userOrgs || [];
    }

    const existingUserIdsInOrg = new Set(
      existingUsersInOrg.map((uo) => uo.userId)
    );
    const existingEmailsInOrg = new Set(
      (usersWithEmail || [])
        .filter((u) => existingUserIdsInOrg.has(u.id))
        .map((u) => u.email)
    );

    // Batch check for existing invites in one query
    const { data: existingInvites, error: existingInvitesError } = await sbDb
      .from("Invite")
      .select("inviteeEmail, teamMemberId")
      .eq("organizationId", organizationId)
      .in("inviteeEmail", emails)
      .eq("status", InviteStatuses.PENDING)
      .gt("expiresAt", new Date().toISOString());

    if (existingInvitesError) throw existingInvitesError;

    /* All emails are already invited */
    if ((existingInvites || []).length === emails.length) {
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
    if (existingEmailsInOrg.size === emails.length) {
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
    if (
      (existingInvites || []).length + existingEmailsInOrg.size ===
      emails.length
    ) {
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

    const existingInviteEmails = (existingInvites || []).map(
      (i) => i.inviteeEmail
    );

    /**
     * We only have to send invite to the
     * - users who have not PENDING invitation and
     * - users who are not part of organization already
     */
    let validPayloads = uniquePayloads.filter(
      (p) =>
        !existingInviteEmails.includes(p.email) &&
        !existingEmailsInOrg.has(p.email)
    );

    /** Remove the users with teamMemberId who already have a user associated */
    validPayloads = validPayloads.filter((payload) => {
      if (!payload.teamMemberId) {
        return true;
      }

      return !teamMembersWithUserId.includes(payload.teamMemberId);
    });

    const validPayloadsWithName = validPayloads.map((p) => ({
      ...p,
      name: p.email.split("@")[0],
    }));

    // Prepare invite data
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_TTL_DAYS);

    let createdInvites: InviteWithInviterAndOrg[] = [];

    const scheduleInviteEmailSending = (
      invites: InviteWithInviterAndOrg[],
      extraInviteMessage?: string | null
    ) => {
      invites.forEach((invite, index) => {
        const batchIndex = Math.floor(index / INVITE_EMAIL_BATCH_SIZE);
        const positionInBatch = index % INVITE_EMAIL_BATCH_SIZE;
        const delay =
          batchIndex * INVITE_EMAIL_BATCH_DELAY_MS +
          positionInBatch * INVITE_EMAIL_SPACING_MS;

        setTimeout(async () => {
          const token = jwt.sign({ id: invite.id }, INVITE_TOKEN_SECRET, {
            expiresIn: `${INVITE_EXPIRY_TTL_DAYS}d`,
          });

          const html = await invitationTemplateString({
            invite,
            token,
            extraMessage: extraInviteMessage,
          });

          sendEmail({
            to: invite.inviteeEmail,
            subject: `\u2709\uFE0F You have been invited to ${invite.organization.name}`,
            text: inviteEmailText({
              invite,
              token,
              extraMessage: extraInviteMessage,
            }),
            html,
          });
        }, delay);
      });
    };

    // Sequential Supabase calls (no transaction support)
    // Bulk create all required team members
    const teamMemberInserts = validPayloadsWithName
      .filter((p) => !p.teamMemberId)
      .map((p) => ({
        name: p.name,
        organizationId,
      }));

    let createdTeamMembers: Sb.TeamMemberRow[] = [];
    if (teamMemberInserts.length > 0) {
      const { data: tmData, error: tmCreateError } = await sbDb
        .from("TeamMember")
        .insert(teamMemberInserts)
        .select("*");

      if (tmCreateError) throw tmCreateError;
      createdTeamMembers = tmData || [];
    }

    /**
     * This helper function returns the correct teamMemberId required for creating an invite
     */
    const getTeamMemberId = (payload: InviteUserSchema & { name: string }) => {
      if (payload.teamMemberId) {
        return payload.teamMemberId;
      }

      const createdTm = createdTeamMembers.find(
        (tm) => tm.name === payload.name
      );
      invariant(
        createdTm,
        "Unexpected situation! Could not find teamMember in createdTeamMembers."
      );

      return createdTm.id;
    };

    const invitesToCreate = validPayloadsWithName.map((payload) => ({
      inviterId: userId,
      organizationId,
      inviteeEmail: payload.email,
      teamMemberId: getTeamMemberId(payload),
      roles: [payload.role],
      expiresAt: expiresAt.toISOString(),
      inviteCode: generateRandomCode(6),
      status: InviteStatuses.PENDING,
      ...(sanitizedMessage && { inviteMessage: sanitizedMessage }),
    }));

    if (invitesToCreate.length > 0) {
      const { data: inviteData, error: inviteCreateError } = await sbDb
        .from("Invite")
        .insert(invitesToCreate)
        .select("*");

      if (inviteCreateError) throw inviteCreateError;

      // Fetch inviter and organization separately (Relationships not typed)
      const [inviterResult, orgResult] = await Promise.all([
        sbDb
          .from("User")
          .select("firstName, lastName")
          .eq("id", userId)
          .single(),
        sbDb.from("Organization").select("*").eq("id", organizationId).single(),
      ]);

      if (inviterResult.error) throw inviterResult.error;
      if (orgResult.error) throw orgResult.error;

      createdInvites = (inviteData || []).map((inv) => ({
        ...inv,
        inviter: inviterResult.data,
        organization: orgResult.data,
      }));
    }

    if (createdInvites.length > 0) {
      scheduleInviteEmailSending(createdInvites, sanitizedMessage);
    }

    sendNotification({
      title: "Successfully invited users",
      message: `${createdInvites.length} user(s) have been invited successfully. They will receive an email in which they can complete their registration.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    const skippedUsers = users.filter((user) => {
      if (existingInviteEmails.includes(user.email)) {
        return true;
      }

      if (existingEmailsInOrg.has(user.email)) {
        return true;
      }

      if (
        user.teamMemberId &&
        teamMembersWithUserId.includes(user.teamMemberId)
      ) {
        return true;
      }

      return false;
    });

    return {
      inviteSentUsers: validPayloads,
      skippedUsers,
      extraMessage:
        createdInvites.length > 10
          ? "You are sending more than 10 invites, so some of the emails might get slightly delayed. If one of the invitees hasn't received the email within 5-10 minutes, you can use the Resend invite feature to send the email again."
          : undefined,
    };
  } catch (cause) {
    let message = "Something went wrong while inviting users.";

    if (isLikeShelfError(cause)) {
      message = cause.message;
    }

    throw new ShelfError({
      cause,
      message,
      label,
      additionalData: { users, userId, organizationId, extraMessage },
    });
  }
}
