/**
 * Invite Roles
 *
 * Single source of truth for which organization roles an invite may grant.
 *
 * This lives in its own dependency-free module (no `.server` suffix, no React)
 * so that both the client invite form and the server-side CSV import can import
 * it. Duplicating the list in either place would let the two drift, and the
 * whole point of this constant is that they cannot.
 *
 * @see {@link file://./../../components/settings/invite-user-dialog.tsx}
 * @see {@link file://./../../routes/api+/settings.import-users.ts}
 */

import { OrganizationRoles } from "@prisma/client";

/**
 * Roles that may be granted through an invite.
 *
 * `OWNER` is deliberately absent. There is exactly one supported way to move
 * ownership — `transferOwnership`, which demotes the outgoing owner, moves the
 * subscription and notifies both parties. `changeUserRole` refuses `OWNER` for
 * the same reason. An invite that granted `OWNER` would bypass all of that and
 * leave `Organization.owner` pointing at the previous owner while the invitee
 * held every OWNER privilege, because permissions resolve from
 * `UserOrganization.roles`, never from `Organization.owner`.
 */
export const INVITABLE_ROLES = [
  OrganizationRoles.ADMIN,
  OrganizationRoles.BASE,
  OrganizationRoles.SELF_SERVICE,
] as const;

/** A role that may be granted through an invite. */
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * Whether a value is a role an invite is allowed to grant.
 *
 * Accepts `unknown` on purpose: the CSV import path receives arbitrary strings
 * from an uploaded file, so the check has to be a runtime narrowing rather than
 * a type assertion.
 *
 * @param value - Candidate role, typically straight from user input
 * @returns True when the value is one of {@link INVITABLE_ROLES}
 */
export function isInvitableRole(value: unknown): value is InvitableRole {
  return INVITABLE_ROLES.includes(value as InvitableRole);
}
