/**
 * Client-side permission gating for the webapp UI.
 *
 * Thin adapter over the shared `roleHasPermission` resolver in
 * `@shelf/permissions`: the SAME matrix, the SAME ADMIN/OWNER allow-all
 * short-circuit and the SAME workspace switches the server validator
 * enforces, so what the UI shows and what the server permits cannot drift.
 *
 * The roles `useOrganizationRoles()` hands out carry the workspace's
 * permission switches (`MemberRoles`), so every `userHasPermission({ roles,
 * ... })` call sees what the owner switched on without passing it itself.
 *
 * These checks are cosmetic (hide/show UI). Every mutation they gate is
 * independently enforced server-side via `requirePermission` /
 * `requireMobilePermission`.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 * @see {@link file://./permission.validator.server.ts} — the server counterpart
 */
import type { OrganizationRoles } from "@prisma/client";
import type { PermissionAction, PermissionEntity } from "@shelf/permissions";
import { roleHasPermission } from "@shelf/permissions";
import type { MemberRoles } from "./member-roles";
import { workspaceGrantsOf } from "./member-roles";
import type { WorkspaceGrantSettings } from "./role-access";

type UserHasPermissionArgs = {
  /**
   * Roles of the user, usually from `useOrganizationRoles()`, which carry the
   * workspace's permission switches.
   */
  roles: MemberRoles | OrganizationRoles[] | undefined;

  /** Entity for which we have to check for permission */
  entity: PermissionEntity;

  /**
   * The  actions which we have to check. It can be a string of type PermissionAction or an array.
   * If an array is provided, then any single permission match will return `true`
   */
  action: PermissionAction | PermissionAction[];

  /**
   * The workspace's permission switches, when the roles do not carry them
   * (roles from loader data rather than `useOrganizationRoles()`).
   */
  workspace?: WorkspaceGrantSettings | null;

  /**
   * `false` answers from the matrix alone: for UI whose server route opts out
   * of the workspace switches the same way.
   */
  workspaceGrants?: boolean;
};

/**
 * Checks whether a user holds a role granting `action` on `entity`, counting
 * the permissions the workspace's switches add.
 *
 * @param roles - The user's roles in the active organization. `undefined` or
 *   empty denies — the safe direction while the session is still loading.
 * @param entity - The permission entity being checked.
 * @param action - A single action, or an array meaning ANY-match.
 * @param workspace - Switches to use instead of the ones the roles carry.
 * @param workspaceGrants - `false` ignores every switch.
 * @returns `true` when any held role grants it.
 * @throws Never — unknown roles/entities resolve to `false`.
 */
export function userHasPermission({
  roles,
  action,
  entity,
  workspace,
  workspaceGrants,
}: UserHasPermissionArgs): boolean {
  return roleHasPermission({
    roles,
    entity,
    action,
    workspace: workspace !== undefined ? workspace : workspaceGrantsOf(roles),
    workspaceGrants,
  });
}
