/**
 * Organization role precedence, in one place.
 *
 * Several features need "which of these roles wins": SSO resolves a role from
 * a user's IdP group claims (a user can be in several groups), and every
 * authorization decision on a membership (`roles` is an array) acts on its most
 * privileged role. The order is declared once here and consumed, so those
 * features cannot disagree about it.
 *
 * Nothing here touches the server, so client code that shows or hides an
 * action can resolve the role exactly as the server does.
 *
 * @see {@link file://./roles.server.ts} `getRoleFromGroupId` — SSO group claims
 * @see {@link file://./booking-authorization.server.ts} `validateBookingOwnership`
 */

import { OrganizationRoles } from "@prisma/client";

/**
 * Every organization role, most privileged first.
 *
 * "Most privileged" means: if a membership carries several roles, this is the
 * order in which one of them should be treated as the effective role for an
 * authorization decision.
 */
export const ROLE_PRECEDENCE = [
  OrganizationRoles.OWNER,
  OrganizationRoles.ADMIN,
  OrganizationRoles.SELF_SERVICE,
  OrganizationRoles.BASE,
] as const;

/**
 * The subset assignable via SSO group mapping, most privileged first.
 *
 * OWNER is deliberately absent: ownership is a property of who created or was
 * transferred the workspace, never something an IdP group can confer. Deriving
 * this from {@link ROLE_PRECEDENCE} keeps the shared ordering while making that
 * exclusion explicit rather than an omission someone might "fix".
 */
export const SSO_ASSIGNABLE_ROLE_PRECEDENCE = ROLE_PRECEDENCE.filter(
  (role) => role !== OrganizationRoles.OWNER
);

/**
 * Picks the most privileged role from a membership's role array.
 *
 * Read this, not `roles[0]`, for any authorization decision: a membership
 * ordered `[SELF_SERVICE, ADMIN]` is an admin. The servers judge a request by
 * this role, so a client gate that reads anything else disagrees with them.
 *
 * @param roles - Every role on the membership
 * @returns The first role of {@link ROLE_PRECEDENCE} the membership holds,
 *   otherwise `roles[0]`, defaulting to BASE for an empty membership
 */
export function resolveMostPrivilegedRole(
  roles: readonly OrganizationRoles[]
): OrganizationRoles {
  return (
    ROLE_PRECEDENCE.find((candidate) => roles.includes(candidate)) ??
    roles[0] ??
    OrganizationRoles.BASE
  );
}
