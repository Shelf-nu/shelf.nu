/**
 * Organization Roles
 *
 * Maps each `OrganizationRoles` enum value to the label users see for it
 * ("Administrator", "Self service", ...). Client-safe: imported by team
 * settings components, the account subscription page and several server
 * modules (invites, role changes, team listings), so it must never import a
 * `*.server` module.
 *
 * @see {@link file://./../routes/_layout+/settings.team.tsx}
 * @see {@link file://./../modules/settings/service.server.ts}
 */

import { OrganizationRoles } from "@prisma/client";

/** The user-facing name of an organization role. */
export type UserFriendlyRoles =
  | "Administrator"
  | "Owner"
  | "Base"
  | "Self service";

/**
 * User-facing label for every organization role, keyed by the
 * `OrganizationRoles` enum value.
 */
export const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.OWNER]: "Owner",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};
