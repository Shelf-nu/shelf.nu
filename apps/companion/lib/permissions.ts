/**
 * Client-side permission helpers for the mobile companion app.
 *
 * No longer a hand-copied mirror: both helpers delegate to the shared
 * `@shelf/permissions` package — the SAME matrix + resolution logic
 * (including the ADMIN/OWNER allow-all short-circuit) that the webapp's
 * server validator uses, so web and mobile can never drift.
 *
 * These checks remain purely cosmetic (hide/show UI) — the server
 * independently enforces permissions via requireMobilePermission on every
 * API call.
 *
 * @see {@link file://../../../packages/permissions/src/index.ts}
 */
import type { PermissionAction, PermissionEntity } from "@shelf/permissions";
import { roleHasPermission } from "@shelf/permissions";

/**
 * Returns true when the user holds an org role that grants visibility
 * across the entire workspace (not just their assignments).
 *
 * Why this helper exists separately from `userHasPermission`: the audit
 * mobile endpoint silently scopes BASE/SELF_SERVICE callers to their
 * own assignments regardless of any query flags. Surfacing a UI toggle
 * that promises "All audits" to those roles is a lie — the chip flips
 * visually, but the result set never widens. Use this to hide / disable
 * UI that only makes sense for users who can actually opt into a wider
 * scope.
 *
 * @param roles The user's org-role strings as returned by `/me`
 *   (`Organization.roles`). `undefined` or empty arrays default to
 *   "no widening" — safe direction for ambiguous state.
 * @returns `true` only when the array contains `"OWNER"` or `"ADMIN"`.
 * @throws Never — pure predicate; defends `roles?.length` for the
 *   nullable/undefined input case.
 */
export function userCanSeeOrgWideAudits(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  return roles.some((role) => role === "OWNER" || role === "ADMIN");
}

/**
 * Checks if a user with the given roles has permission for an entity/action.
 * Returns true if any of the user's roles grant the permission.
 *
 * Thin adapter over the shared resolver: call sites keep passing plain
 * string literals (`"asset"`, `"create"`), which the shared package accepts
 * as template-literal types of its enums.
 *
 * @param roles - The user's org-role strings as returned by `/me`.
 * @param entity - The permission entity being checked.
 * @param action - The action being checked on that entity.
 * @returns `true` when any held role grants the action on the entity.
 * @throws Never — unknown roles/entities safely resolve to `false`.
 */
export function userHasPermission({
  roles,
  entity,
  action,
}: {
  roles: string[] | undefined;
  entity: `${PermissionEntity}`;
  action: `${PermissionAction}`;
}): boolean {
  return roleHasPermission({ roles, entity, action });
}
