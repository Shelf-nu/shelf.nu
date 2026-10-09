/**
 * Invite Roles
 *
 * Which organization roles an invite may grant, read from each role's
 * `membership.invitable` policy field, so the invite dialog, the CSV import,
 * resend and invite acceptance all ask the policy table.
 *
 * OWNER is never invitable. Ownership moves only through `transferOwnership`,
 * which demotes the outgoing owner, moves the subscription and notifies both
 * parties. Permissions resolve from `UserOrganization.roles`, never from
 * `Organization.owner`, so an OWNER invite would bypass all of that and leave
 * `Organization.owner` pointing at the previous owner.
 *
 * Dependency-free (no `.server` suffix, no React) so client and server import it.
 *
 * @see {@link file://./../../utils/permissions/role-access.ts}
 * @see {@link file://./../../components/settings/invite-user-dialog.tsx}
 * @see {@link file://./../../routes/api+/settings.import-users.ts}
 */
import type { OrganizationRole } from "~/utils/permissions/role-access";
import {
  INVITABLE_ROLES,
  ROLE_LABELS,
  ROLE_POLICIES,
  isOrganizationRole,
} from "~/utils/permissions/role-access";

/** Roles an invite may grant, most privileged first. Never includes OWNER. */
export { INVITABLE_ROLES };

/** A role that may be granted through an invite. */
export type InvitableRole = OrganizationRole;

/**
 * Whether a value is a role an invite may grant.
 *
 * Accepts `unknown` because the CSV import receives arbitrary strings from an
 * uploaded file, so the check is a runtime narrowing, not a type assertion.
 *
 * @param value - Candidate role, typically straight from user input
 * @returns True when the value is a role whose policy marks it invitable
 */
export function isInvitableRole(value: unknown): value is InvitableRole {
  return isOrganizationRole(value) && ROLE_POLICIES[value].membership.invitable;
}

/**
 * Reads a role a person typed, as in a CSV import cell, into an invitable role.
 *
 * Accepts the role key in any case (`manager`, `SELF_SERVICE`) and the label
 * the app shows for it (`Self service`, `Administrator`), so a file written
 * from what people see in the UI imports as-is. Surrounding spaces are ignored.
 *
 * @param value - The raw cell text
 * @returns The invitable role, or `null` when the text names no role an
 *   invite may grant (OWNER included)
 */
export function parseInvitableRole(value: string): InvitableRole | null {
  const text = value.trim().toUpperCase();
  if (isInvitableRole(text)) return text;
  return (
    INVITABLE_ROLES.find((role) => ROLE_LABELS[role].toUpperCase() === text) ??
    null
  );
}
