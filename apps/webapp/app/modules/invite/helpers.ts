/**
 * Invite Helpers
 *
 * Pure helpers for invites: email normalisation and matching, invite codes,
 * plain-text email bodies, and splitting a team member name into first and
 * last name.
 *
 * @see {@link file://./service.server.ts}
 */
import type { Prisma } from "@prisma/client";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { resolveUserDisplayName } from "~/utils/user";
import type { InviteWithInviterAndOrg } from "./types";

/**
 * Normalises an invitee email to the form in which invites are stored and
 * compared: trimmed and lowercased.
 *
 * Sign-in lowercases the address, so an invite that keeps the capitals of a
 * CSV row never equals the invitee's account email. Every path that creates
 * an invite, or looks one up by an email from outside, calls this first.
 *
 * @param email - The address as typed or imported
 * @returns The trimmed, lowercased address
 */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Prisma filter for an email column that matches the given addresses without
 * regard to letter case.
 *
 * Stored `Invite.inviteeEmail` and `User.email` values can contain capitals,
 * so an exact match misses the same person. The filter uses `in`, not
 * `equals`: with `mode: "insensitive"`, Prisma compiles `equals` to an
 * unescaped `ILIKE`, where `_` and `%` in an address are wildcards that match
 * other addresses. `in` compiles to `LOWER(column) IN (LOWER(value), ...)`,
 * which is an exact comparison.
 *
 * @param emails - One address or a list; each is normalised first
 * @returns A string filter for `inviteeEmail` or `email`
 */
export function caseInsensitiveEmailFilter(emails: string | string[]) {
  const list = Array.isArray(emails) ? emails : [emails];

  return {
    in: list.map(normalizeInviteEmail),
    mode: "insensitive" as const,
  } satisfies Prisma.StringFilter;
}

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

${resolveUserDisplayName(
  invite.inviter
)} invites you to join Shelf as a member of ${
  invite.organization.name
}'s workspace.
${
  extraMessage
    ? `
---
Message from ${resolveUserDisplayName(invite.inviter)}:

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

export function splitName(fullName?: string | null): {
  firstName: string;
  lastName: string;
} {
  const trimmed = (fullName ?? "").trim();
  const spaceIndex = trimmed.indexOf(" ");

  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: "" };
  }

  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim(),
  };
}

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
  previousRole,
  newRole,
  customEmailFooter,
}: {
  orgName: string;
  previousRole: string;
  newRole: string;
  customEmailFooter?: string | null;
}) => `Howdy,

Your role in ${orgName} has been changed from ${previousRole} to ${newRole}.

If you think this is a mistake, please contact the workspace administrator.
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
The Shelf Team
`;
