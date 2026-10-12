/**
 * Announcement audience: which role an in-app update ("announcement") targets
 * for a member, and how the Shelf-staff form's role checkboxes are read.
 *
 * The layout's unread badge and the updates page both resolve the member's
 * role through `announcementRole`, so a member never sees a count for updates
 * the list does not show.
 *
 * @see {@link file://./service.server.ts} getUpdatesForUser, getUnreadCountForUser
 * @see {@link file://../../components/update/update-form.tsx}
 */
import type { OrganizationRole } from "~/utils/permissions/role-access";
import { ROLES_BY_RANK, resolveRole } from "~/utils/permissions/role-access";

/**
 * The role announcements target for a membership: its effective role.
 *
 * @param roles - Every role on the membership
 * @returns The effective role, or `null` for a membership with no roles
 *   (it is targeted by no role-specific announcement)
 */
export function announcementRole(
  roles: readonly string[] | undefined
): OrganizationRole | null {
  return roles?.length ? resolveRole(roles) : null;
}

/**
 * The checkbox field name for a role on the update form: "target" followed by
 * the role in PascalCase (ADMIN is `targetAdmin`, SELF_SERVICE is
 * `targetSelfService`). Derived rather than listed so every role gets a
 * checkbox, while the names stay the ones already-open forms post.
 *
 * @param role - The role the checkbox targets
 * @returns The form field name for that role's checkbox
 */
export function targetRoleField(role: OrganizationRole): string {
  return `target${role
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join("")}`;
}

/**
 * The target roles the update form submitted, most privileged first.
 * An empty list means "visible to everyone".
 *
 * @param formData - The submitted form; a checked box posts its `targetRoleField` name
 * @returns The checked roles in rank order
 */
export function parseTargetRoles(formData: FormData): OrganizationRole[] {
  return ROLES_BY_RANK.filter((role) =>
    Boolean(formData.get(targetRoleField(role)))
  );
}
