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
} invited you to their Shelf workspace: ${invite.organization.name}.

→ Accept invite: ${SERVER_URL}/accept-invite/${invite.id}?token=${token}

What is Shelf?
Asset tracking that doesn't suck. QR codes, bookings, team collaboration - the stuff spreadsheets can't do.

Once you're in:
- See all assets in ${invite.organization.name}
- Create bookings
- Track locations
- Collaborate with your team

Questions? ${SUPPORT_EMAIL}

${extraMessage ? extraMessage : ""}

Thanks,
The Shelf Team

P.S. - Need labels? → http://store.shelf.nu
`;

export const revokeAccessEmailText = ({
  orgName,
}: {
  orgName: string;
}) => `Howdy,

Your access to ${orgName} on Shelf has been revoked.

If this is a mistake, contact the workspace administrator.

Need your own workspace? Create one free → ${SERVER_URL}

Thanks,
The Shelf Team
`;
