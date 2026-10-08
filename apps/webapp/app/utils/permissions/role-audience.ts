/**
 * Role Audience Wording
 *
 * Turns a set of roles chosen by a policy field into the plain-English group
 * that UI copy names ("owners, administrators and managers"), so a sentence
 * about who is notified or who can be picked follows the policy table instead
 * of a hand-written list that drifts when a role is added.
 *
 * @see {@link file://./role-access.ts}
 */
import type { RolePolicy } from "./role-access";
import { ROLE_LABELS, rolesWhere } from "./role-access";

/**
 * Names, in lower-case plural and most privileged first, the roles whose
 * policy satisfies `predicate`.
 *
 * @param predicate - Picks the roles from their policy, e.g.
 *   `(p) => p.notifications.orgBookingBroadcasts`
 * @returns e.g. "owners, administrators and managers"; an empty string when no
 *   role matches
 */
export function describeRoleAudience(
  predicate: (policy: RolePolicy) => boolean
): string {
  const names = rolesWhere(predicate).map(
    (role) => `${ROLE_LABELS[role].toLowerCase()}s`
  );
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
