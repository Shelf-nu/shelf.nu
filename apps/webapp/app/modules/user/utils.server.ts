/**
 * Team User Actions
 *
 * Server handlers for the actions on the team settings pages: delete a user,
 * revoke access, change a role, and resend or cancel an invite.
 *
 * @see {@link file://./../../routes/_layout+/settings.team.users.tsx}
 * @see {@link file://./../../routes/_layout+/settings.team.invites.tsx}
 * @see {@link file://./../invite/service.server.ts}
 */
import {
  InviteStatuses,
  OrganizationRoles as OrgRolesEnum,
} from "@prisma/client";
import { redirect } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { roleChangeTemplateString } from "~/emails/role-change-template";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { payload, parseData } from "~/utils/http.server";
import { roleChangeRequiresOwner } from "~/utils/permissions/membership-access";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { validatePermission } from "~/utils/permissions/permission.validator.server";
import type { RoleAccess } from "~/utils/permissions/role-access";
import {
  ROLE_LABELS,
  labelToRole,
  resolveRole,
} from "~/utils/permissions/role-access";
import { assertCanAssignRoles } from "~/utils/permissions/role-assignment.server";
import { isDemotion } from "~/utils/roles";
import { randomUsernameFromEmail } from "~/utils/user";
import {
  changeUserRole,
  revokeAccessToOrganization,
  transferEntitiesToNewOwner,
} from "./service.server";
import {
  caseInsensitiveEmailFilter,
  revokeAccessEmailText,
  roleChangeEmailText,
} from "../invite/helpers";
import { isInvitableRole } from "../invite/roles";
import { createInvite } from "../invite/service.server";

/**
 * Handles the team actions posted from the team users list, the member page
 * and the invites list: delete a team member, revoke access, resend or cancel
 * an invite, and change a role.
 *
 * @param request - The action request; its form data carries the `intent`
 * @param organizationId - The caller's current organization
 * @param userId - The acting user's id
 * @param callerAccess - The acting member's resolved access (from requirePermission)
 * @throws {ShelfError} On invalid input, or 403 when the caller may not act on
 *   the target or grant the requested role
 */
export async function resolveUserAction(
  request: Request,
  organizationId: string,
  userId: string,
  callerAccess: RoleAccess
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

      await db.teamMember
        .update({
          where: {
            id: teamMemberId,
            organizationId,
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to delete team member",
            additionalData: { teamMemberId, userId, organizationId },
            label: "Team",
          });
        });

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

      /**
       * Same rule as `changeUserRole`: a member whose effective role needs the
       * owner to change it (Administrator, Owner) can only have access revoked
       * by the workspace owner. Revoking is the stronger action, so it can
       * never be looser than a role change.
       *
       * Revoking the OWNER is also refused by `revokeAccessToOrganization`
       * itself, so it holds for every caller rather than only this one.
       */
      const targetUserOrg = await db.userOrganization.findFirst({
        where: { userId: targetUserId, organizationId },
        select: { roles: true },
      });
      const targetRole = targetUserOrg
        ? resolveRole(targetUserOrg.roles)
        : null;

      if (
        targetRole &&
        roleChangeRequiresOwner(targetRole) &&
        !callerAccess.ownsWorkspace
      ) {
        throw new ShelfError({
          cause: null,
          title: "Insufficient permissions",
          message: `Only the workspace owner can revoke access for a member with the ${ROLE_LABELS[targetRole]} role.`,
          additionalData: { organizationId, targetUserId },
          label: "Team",
          status: 403,
          shouldBeCaptured: false,
        });
      }

      const user = await revokeAccessToOrganization({
        userId: targetUserId,
        organizationId,
      });

      const org = await db.organization
        .findUniqueOrThrow({
          where: {
            id: organizationId,
          },
          select: {
            name: true,
            customEmailFooter: true,
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Organization not found",
            additionalData: { organizationId, targetUserId, userId },
            label: "Team",
          });
        });

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

      await db.invite
        .updateMany({
          where: {
            inviteeEmail: caseInsensitiveEmailFilter(inviteeEmail),
            organizationId,
            status: InviteStatuses.PENDING,
          },
          data: {
            status: InviteStatuses.INVALIDATED,
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to cancel invites",
            additionalData: { userId, organizationId, inviteeEmail },
            label: "Team",
          });
        });

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

      /** The form submits the role's label; map it back through ROLE_LABELS. */
      const role = labelToRole(userFriendlyRole);

      /**
       * `userFriendlyRole` is free text from the form. `labelToRole` knows
       * every role's label, including Owner, so the invitable check is what
       * refuses an Owner invite. Ownership moves only through
       * `transferOwnership`.
       */
      if (!role || !isInvitableRole(role)) {
        throw new ShelfError({
          cause: null,
          message: "Invalid role",
          additionalData: { userFriendlyRole },
          label: "Team",
          status: 400,
          shouldBeCaptured: false,
        });
      }

      // Authorize before invalidating: a refused resend must leave the
      // existing invite pending.
      assertCanAssignRoles({
        actorOwnsWorkspace: callerAccess.ownsWorkspace,
        roles: [role],
        organizationId,
      });

      /**
       * Invalidate every earlier invite for this person in this organization
       * before creating the new one. The two steps run in order: the new
       * invite matches the same email, so an invalidation that finishes later
       * would close it too, and `createInvite` refuses while another pending
       * invite for the person exists.
       */
      await db.invite
        .updateMany({
          where: {
            inviteeEmail: caseInsensitiveEmailFilter(inviteeEmail),
            organizationId,
          },
          data: {
            status: InviteStatuses.INVALIDATED,
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to invalidate previous invites",
            additionalData: { userId, organizationId, inviteeEmail },
            label: "Team",
          });
        });

      /** Create a new invite, based on the prev invite's role */
      const invite = await createInvite({
        organizationId,
        inviteeEmail,
        teamMemberName,
        teamMemberId,
        inviterId: userId,
        roles: [role],
        userId,
        actorOwnsWorkspace: callerAccess.ownsWorkspace,
      });

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
        roles: [callerAccess.role],
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
      const targetUserOrg = await db.userOrganization.findFirst({
        where: { userId: targetUserId, organizationId },
      });

      if (!targetUserOrg) {
        throw new ShelfError({
          cause: null,
          message: "User is not a member of this organization",
          label: "Team",
          shouldBeCaptured: false,
        });
      }

      const currentRole = targetUserOrg.roles[0];

      /** Transfer entities on demotion */
      if (isDemotion(currentRole, newRole)) {
        const org = await db.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { userId: true },
        });

        const recipientId = transferToUserId || org.userId;

        /** Validate that the transfer recipient is a member of this org */
        if (transferToUserId) {
          const recipientOrg = await db.userOrganization.findFirst({
            where: { userId: transferToUserId, organizationId },
          });

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
          // The demoted user keeps their org membership (only their role
          // rank drops), so only OWNERSHIP columns move — see
          // EntityTransferReason's JSDoc in service.server.ts.
          await transferEntitiesToNewOwner({
            tx,
            id: targetUserId,
            newOwnerId: recipientId,
            organizationId,
            reason: "demotion",
          });

          await changeUserRole({
            userId: targetUserId,
            organizationId,
            newRole,
            callerRole: callerAccess.role,
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
            callerRole: callerAccess.role,
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
      const [targetUser, org] = await Promise.all([
        db.user.findUniqueOrThrow({
          where: { id: targetUserId },
          select: { email: true },
        }),
        db.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { name: true, customEmailFooter: true },
        }),
      ]);

      const roleName = ROLE_LABELS[newRole];
      const previousRoleName = ROLE_LABELS[currentRole];

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
  // Generate all candidate usernames upfront and check in a single query
  const candidates = Array.from({ length: MAX_USERNAME_ATTEMPTS }, () =>
    randomUsernameFromEmail(email)
  );

  const existingUsers = await db.user.findMany({
    where: { username: { in: candidates } },
    select: { username: true },
  });

  const takenUsernames = new Set(existingUsers.map((u) => u.username));
  const availableUsername = candidates.find((u) => !takenUsernames.has(u));

  if (availableUsername) {
    return availableUsername;
  }

  throw new ShelfError({
    cause: null,
    message: "Unable to generate unique username after maximum attempts",
    label: "User",
    additionalData: { email, attempts: MAX_USERNAME_ATTEMPTS },
  });
}
