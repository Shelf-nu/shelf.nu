/**
 * Organization role precedence, in one place.
 *
 * Two unrelated features need "which of these roles wins": SSO resolves a role
 * from a user's IdP group claims (a user can be in several groups), and the
 * booking ownership guard resolves how privileged a membership is (`roles` is
 * an array). Both were stating the order independently, which is how they
 * silently drift.
 *
 * The order is deliberately declared once and consumed, rather than each site
 * writing its own if/else chain.
 *
 * @see {@link file://./roles.server.ts} `getRoleFromGroupId` — SSO group claims
 * @see {@link file://./booking-authorization.server.ts} `resolveMostPrivilegedRole`
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
