/**
 * Client-side permission gating for the webapp UI.
 *
 * Thin adapter over the shared `roleHasPermission` resolver in
 * `@shelf/permissions` — the SAME matrix and the SAME ADMIN/OWNER allow-all
 * short-circuit the server validator enforces, so what the UI shows and what
 * the server permits cannot drift.
 *
 * These checks are cosmetic (hide/show UI). Every mutation they gate is
 * independently enforced server-side via `requirePermission` /
 * `requireMobilePermission`.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 * @see {@link file://./permission.validator.server.ts} — the server counterpart
 */
import type { OrganizationRoles } from "@prisma/client";
import { roleHasPermission } from "@shelf/permissions";

import type { PermissionAction, PermissionEntity } from "./permission.data";

type UserHasPermissionArgs = {
  /** Role of the user for which we have to check for permission */
  roles: OrganizationRoles[] | undefined;

  /** Entity for which we have to check for permission */
  entity: PermissionEntity;

  /**
   * The  actions which we have to check. It can be a string of type PermissionAction or an array.
   * If an array is provided, then any single permission match will return `true`
   */
  action: PermissionAction | PermissionAction[];
};

/**
 * Checks whether a user holds a role granting `action` on `entity`.
 *
 * @param roles - The user's roles in the active organization. `undefined` or
 *   empty denies — the safe direction while the session is still loading.
 * @param entity - The permission entity being checked.
 * @param action - A single action, or an array meaning ANY-match.
 * @returns `true` when any held role grants it.
 * @throws Never — unknown roles/entities resolve to `false`.
 */
export function userHasPermission({
  roles,
  action,
  entity,
}: UserHasPermissionArgs): boolean {
  return roleHasPermission({ roles, entity, action });
}
