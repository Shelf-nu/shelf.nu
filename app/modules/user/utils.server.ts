import type { OrganizationRoles } from "@prisma/client";
import { InviteStatuses } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { organizationRolesMap } from "~/routes/_layout+/settings.team";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { data, parseData } from "~/utils/http.server";
import { randomUsernameFromEmail } from "~/utils/user";
import { revokeAccessToOrganization } from "./service.server";
import { revokeAccessEmailText } from "../invite/helpers";
import { createInvite } from "../invite/service.server";

/**
 * This function handles the user actions such as deleting, revoking access, resending invite, and cancelling invite.
 * It is currently used in the settings/team/users index & user page.
 */
export async function resolveUserAction(
  request: Request,
  organizationId: string,
  userId: string
) {
  const formData = await request.formData();

  const { intent } = parseData(
    formData,
    z.object({
      intent: z.enum(["delete", "revokeAccess", "resend", "cancelInvite"]),
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
        text: revokeAccessEmailText({ orgName: org.name }),
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
            inviteeEmail,
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
        await db.invite
          .updateMany({
            where: {
              inviteeEmail,
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

      return json(data(null));
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
    const existingUser = await db.user.findUnique({
      where: { username },
      select: { id: true },
    });

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
