import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import type { InviteWithInviterAndOrg } from "./types";

export function generateRandomCode(length: number): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }
  return code;
}

export const inviteEmailText = ({
  invite,
  token,
  extraMessage,
}: {
  invite: InviteWithInviterAndOrg;
  token: string;
  extraMessage?: string | null;
}) => `Howdy,

${invite.inviter.firstName} ${
  invite.inviter.lastName
} invites you to join Shelf as a member of ${
  invite.organization.name
}'s workspace.
${
  extraMessage
    ? `
---
Message from ${invite.inviter.firstName} ${invite.inviter.lastName}:

${extraMessage}
---
`
    : ""
}
Click the link to accept the invite:
${SERVER_URL}/accept-invite/${invite.id}?token=${token}

Once you're done setting up your account, you'll be able to access the workspace and start exploring features like Asset Explorer, Location Tracking, Collaboration, Custom fields and more.

If you have any questions or need assistance, please don't hesitate to contact our support team at ${SUPPORT_EMAIL}.
${
  invite.organization.customEmailFooter
    ? `\n---\n${invite.organization.customEmailFooter}`
    : ""
}
Thanks,
The Shelf Team
`;

export const revokeAccessEmailText = ({
  orgName,
  customEmailFooter,
}: {
  orgName: string;
  customEmailFooter?: string | null;
}) => `Howdy,

Your access to ${orgName} has been revoked.

If you think this is a mistake, please contact the organization's administrator.
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
The Shelf Team
`;

export const roleChangeEmailText = ({
  orgName,
  newRole,
  customEmailFooter,
}: {
  orgName: string;
  newRole: string;
  customEmailFooter?: string | null;
}) => `Howdy,

Your role in ${orgName} has been changed to ${newRole}.

If you think this is a mistake, please contact the workspace administrator.
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
The Shelf Team
`;
