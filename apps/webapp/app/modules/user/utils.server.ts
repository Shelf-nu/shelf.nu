import type { OrganizationRoles } from "@prisma/client";
import {
  InviteStatuses,
  OrganizationRoles as OrgRolesEnum,
} from "@prisma/client";
import { redirect } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { sbDb } from "~/database/supabase.server";
import { sendEmail } from "~/emails/mail.server";
import { roleChangeTemplateString } from "~/emails/role-change-template";
import { organizationRolesMap } from "~/routes/_layout+/settings.team";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { payload, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import { isDemotion } from "~/utils/roles";
import { randomUsernameFromEmail } from "~/utils/user";
import {
  changeUserRole,
  revokeAccessToOrganization,
  transferEntitiesToNewOwner,
} from "./service.server";
import { revokeAccessEmailText, roleChangeEmailText } from "../invite/helpers";
import { createInvite } from "../invite/service.server";

/**
 * This function handles the user actions such as deleting, revoking access, resending invite, and cancelling invite.
 * It is currently used in the settings/team/users index & user page.
 */
export async function resolveUserAction(
  request: Request,
  organizationId: string,
  userId: string,
  callerRole: OrgRolesEnum
) {
  const formData = await request.formData();

  const { intent } = parseData(
    formData,
    z.object({
      intent: z.enum([
        "delete",
        "revokeAccess",
        "resend",
        "cancelInvite",
        "changeRole",
      ]),
    }),
    {
      additionalData: {
        organizationId,
      },
    }
  );

  switch (intent) {
    case "delete": {
      const { teamMemberId } = parseData(
        formData,
        z.object({
          teamMemberId: z.string(),
        }),
        {
          additionalData: {
            organizationId,
            intent,
          },
        }
      );

      const { error: deleteError } = await sbDb
        .from("TeamMember")
        .update({ deletedAt: new Date().toISOString() })
        .eq("id", teamMemberId)
        .eq("organizationId", organizationId)
        .is("deletedAt", null);

      if (deleteError) {
        throw new ShelfError({
          cause: deleteError,
          message: "Failed to delete team member",
          additionalData: { teamMemberId, userId, organizationId },
          label: "Team",
        });
      }

      return redirect(`/settings/team/users`);
    }
    case "revokeAccess": {
      const { userId: targetUserId } = parseData(
        formData,
        z.object({
          userId: z.string(),
        }),
        {
          additionalData: {
            organizationId,
            intent,
          },
        }
      );

      const user = await revokeAccessToOrganization({
        userId: targetUserId,
        organizationId,
      });

      const { data: org, error: orgError } = await sbDb
        .from("Organization")
        .select("name, customEmailFooter")
        .eq("id", organizationId)
        .single();

      if (orgError || !org) {
        throw new ShelfError({
          cause: orgError,
          message: "Organization not found",
          additionalData: { organizationId, targetUserId, userId },
          label: "Team",
        });
      }

      sendEmail({
        to: user.email,
        subject: `Access to ${org.name} has been revoked`,
        text: revokeAccessEmailText({
          orgName: org.name,
          customEmailFooter: org.customEmailFooter,
        }),
      });

      sendNotification({
        title: `Access revoked`,
        message: `User with email ${user.email} no longer has access to this organization`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return redirect("/settings/team/users");
    }
    case "cancelInvite": {
      const { email: inviteeEmail } = parseData(
        formData,
        z.object({
          email: z.string(),
        }),
        {
          additionalData: {
            organizationId,
            intent,
          },
        }
      );

      const { error: cancelError } = await sbDb
        .from("Invite")
        .update({ status: InviteStatuses.INVALIDATED })
        .eq("inviteeEmail", inviteeEmail)
        .eq("organizationId", organizationId)
        .eq("status", InviteStatuses.PENDING);

      if (cancelError) {
        throw new ShelfError({
          cause: cancelError,
          message: "Failed to cancel invites",
          additionalData: { userId, organizationId, inviteeEmail },
          label: "Team",
        });
      }

      sendNotification({
        title: "Invitation cancelled",
        message: "The invitation has successfully been cancelled.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return null;
    }
    case "resend": {
      const {
        email: inviteeEmail,
        name: teamMemberName,
        teamMemberId,
        userFriendlyRole,
      } = parseData(
        formData,
        z.object({
          email: z.string(),
          name: z.string(),
          teamMemberId: z.string(),
          userFriendlyRole: z.string(),
        }),
        {
          additionalData: {
            organizationId,
            intent,
          },
        }
      );

      /** Find the Role based on its user friendly name */
      const role = Object.keys(organizationRolesMap).find(
        (key) => organizationRolesMap[key] === userFriendlyRole
      ) as OrganizationRoles | undefined;

      if (!role) {
        throw new ShelfError({
          cause: null,
          message: "Invalid role",
          additionalData: { userFriendlyRole },
          label: "Team",
        });
      }

      /** Invalidate all previous invites for current user for current organization */

      const [_invalidatedInvites, invite] = await Promise.all([
        sbDb
          .from("Invite")
          .update({ status: InviteStatuses.INVALIDATED })
          .eq("inviteeEmail", inviteeEmail)
          .eq("organizationId", organizationId)
          .then(({ error: invError }) => {
            if (invError) {
              throw new ShelfError({
                cause: invError,
                message: "Failed to invalidate previous invites",
                additionalData: { userId, organizationId, inviteeEmail },
                label: "Team",
              });
            }
          }),

        /** Create a new invite, based on the prev invite's role */
        createInvite({
          organizationId,
          inviteeEmail,
          teamMemberName,
          teamMemberId,
          inviterId: userId,
          roles: [role],
          userId,
        }),
      ]);

      if (invite) {
        sendNotification({
          title: "Successfully invited user",
          message:
            "They will receive an email in which they can complete their registration.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
      }

      return payload(null);
    }
    case "changeRole": {
      await validatePermission({
        roles: [callerRole],
        action: PermissionAction.changeRole,
        entity: PermissionEntity.teamMember,
        organizationId,
        userId,
      });

      const {
        userId: targetUserId,
        role: newRole,
        transferToUserId,
      } = parseData(
        formData,
        z.object({
          userId: z.string(),
          role: z.nativeEnum(OrgRolesEnum),
          transferToUserId: z.string().optional(),
        }),
        {
          additionalData: {
            organizationId,
            intent,
          },
        }
      );

      if (targetUserId === userId) {
        throw new ShelfError({
          cause: null,
          message: "You cannot change your own role",
          label: "Team",
        });
      }

      /** Fetch the target's current role to detect demotion */
      const { data: targetUserOrg, error: targetOrgError } = await sbDb
        .from("UserOrganization")
        .select()
        .eq("userId", targetUserId)
        .eq("organizationId", organizationId)
        .maybeSingle();

      if (targetOrgError) throw targetOrgError;

      if (!targetUserOrg) {
        throw new ShelfError({
          cause: null,
          message: "User is not a member of this organization",
          label: "Team",
        });
      }

      const currentRole = targetUserOrg.roles[0];

      /** Transfer entities on demotion */
      if (isDemotion(currentRole, newRole)) {
        const { data: orgData, error: orgFetchError } = await sbDb
          .from("Organization")
          .select("userId")
          .eq("id", organizationId)
          .single();

        if (orgFetchError || !orgData) {
          throw new ShelfError({
            cause: orgFetchError,
            message: "Organization not found",
            label: "Team",
            additionalData: { organizationId },
          });
        }

        const recipientId = transferToUserId || orgData.userId;

        /** Validate that the transfer recipient is a member of this org */
        if (transferToUserId) {
          const { data: recipientOrg, error: recipientOrgError } = await sbDb
            .from("UserOrganization")
            .select()
            .eq("userId", transferToUserId)
            .eq("organizationId", organizationId)
            .maybeSingle();

          if (recipientOrgError) throw recipientOrgError;

          if (!recipientOrg) {
            throw new ShelfError({
              cause: null,
              message:
                "Transfer recipient is not a member of this organization",
              label: "Team",
              additionalData: { transferToUserId, organizationId },
            });
          }
        }

        await db.$transaction(async (tx) => {
          await transferEntitiesToNewOwner({
            tx,
            id: targetUserId,
            newOwnerId: recipientId,
            organizationId,
            skipInvites: true,
          });

          await changeUserRole({
            userId: targetUserId,
            organizationId,
            newRole,
            callerRole,
            tx,
          });

          await tx.roleChangeLog.create({
            data: {
              userId: targetUserId,
              changedById: userId,
              organizationId,
              previousRole: currentRole,
              newRole,
            },
          });
        });
      } else {
        await db.$transaction(async (tx) => {
          await changeUserRole({
            userId: targetUserId,
            organizationId,
            newRole,
            callerRole,
            tx,
          });

          await tx.roleChangeLog.create({
            data: {
              userId: targetUserId,
              changedById: userId,
              organizationId,
              previousRole: currentRole,
              newRole,
            },
          });
        });
      }

      /** Send email notification to the affected user */
      const [targetUserResult, orgResult] = await Promise.all([
        sbDb.from("User").select("email").eq("id", targetUserId).single(),
        sbDb
          .from("Organization")
          .select("name, customEmailFooter")
          .eq("id", organizationId)
          .single(),
      ]);

      if (targetUserResult.error || !targetUserResult.data) {
        throw new ShelfError({
          cause: targetUserResult.error,
          message: "User not found",
          label: "Team",
          additionalData: { targetUserId },
        });
      }
      if (orgResult.error || !orgResult.data) {
        throw new ShelfError({
          cause: orgResult.error,
          message: "Organization not found",
          label: "Team",
          additionalData: { organizationId },
        });
      }

      const targetUser = targetUserResult.data;
      const org = orgResult.data;

      const roleName = organizationRolesMap[newRole] || newRole;
      const previousRoleName = organizationRolesMap[currentRole] || currentRole;

      sendEmail({
        to: targetUser.email,
        subject: `Your role in ${org.name} has been changed`,
        text: roleChangeEmailText({
          orgName: org.name,
          previousRole: previousRoleName,
          newRole: roleName,
          customEmailFooter: org.customEmailFooter,
        }),
        html: await roleChangeTemplateString({
          orgName: org.name,
          previousRole: previousRoleName,
          newRole: roleName,
          recipientEmail: targetUser.email,
          customEmailFooter: org.customEmailFooter,
        }),
      });

      sendNotification({
        title: "Role updated",
        message: `User role has been changed to ${roleName}`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return payload(null);
    }
    default: {
      throw new ShelfError({
        cause: null,
        message: "Invalid action",
        additionalData: { intent },
        label: "Team",
      });
    }
  }
}

/**
 * Maximum number of attempts to generate a unique username
 * This prevents infinite loops while still providing multiple retry attempts
 */
const MAX_USERNAME_ATTEMPTS = 5;

/**
 * Generates a unique username for a new user with retry mechanism
 * @param email - User's email to base username on
 * @returns Unique username or throws if cannot generate after max attempts
 * @throws {ShelfError} If unable to generate unique username after max attempts
 */
export async function generateUniqueUsername(email: string): Promise<string> {
  let attempts = 0;

  while (attempts < MAX_USERNAME_ATTEMPTS) {
    const username = randomUsernameFromEmail(email);

    // Check if username exists
    const { data: existingUser } = await sbDb
      .from("User")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (!existingUser) {
      return username;
    }

    attempts++;
  }

  throw new ShelfError({
    cause: null,
    message: "Unable to generate unique username after maximum attempts",
    label: "User",
    additionalData: { email, attempts: MAX_USERNAME_ATTEMPTS },
  });
}
