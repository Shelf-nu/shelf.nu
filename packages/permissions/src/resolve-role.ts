/**
 * `@shelf/permissions`, the one effective role of a membership.
 */
import { ROLE_POLICIES } from "./policies";
import type { OrganizationRole } from "./roles";
import { isOrganizationRole } from "./roles";

/**
 * The membership's most privileged known role, by `ROLE_POLICIES[role].rank`.
 *
 * Unknown strings are ignored; an empty or all-unknown list resolves to BASE,
 * the least privileged role, so a malformed or future role can never widen
 * access. This is the role every POLICY decision reads. Matrix checks
 * (`roleHasPermission`) still take the whole array.
 *
 * @param roles - Every role on the membership
 * @returns The highest-rank known role, or BASE
 */
export function resolveRole(
  roles: readonly string[] | undefined
): OrganizationRole {
  let best: OrganizationRole | null = null;
  for (const role of roles ?? []) {
    if (!isOrganizationRole(role)) continue;
    if (best === null || ROLE_POLICIES[role].rank > ROLE_POLICIES[best].rank) {
      best = role;
    }
  }
  return best ?? "BASE";
}
