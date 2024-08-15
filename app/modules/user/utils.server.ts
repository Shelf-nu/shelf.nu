import { InviteStatuses, OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { data, parseData } from "~/utils/http.server";
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
            additionalData: { organizationId },
            label: "Team",
          });
        });

      await sendEmail({
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
      } = parseData(
        formData,
        z.object({
          email: z.string(),
          name: z.string(),
          teamMemberId: z.string(),
        }),
        {
          additionalData: {
            organizationId,
            intent,
          },
        }
      );

      const invite = await createInvite({
        organizationId,
        inviteeEmail,
        teamMemberName,
        teamMemberId,
        inviterId: userId,
        roles: [OrganizationRoles.ADMIN],
        userId,
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
