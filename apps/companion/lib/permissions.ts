/**
 * Client-side matrix check for the companion: `userHasPermission` delegates
 * to `roleHasPermission` in `@shelf/permissions`, the same matrix and
 * resolution logic (including the ADMIN/OWNER allow-all short-circuit and the
 * workspace permission switches) the webapp's server validator uses. Reach
 * questions (whose bookings, custody scope, audit scope) use
 * `lib/role-access.ts`.
 *
 * These checks are purely cosmetic (hide/show UI): the server independently
 * enforces permissions via requireMobilePermission on every API call.
 *
 * @see {@link file://../../../packages/permissions/src/index.ts}
 */
import type { PermissionAction, PermissionEntity } from "@shelf/permissions";
import { roleHasPermission } from "@shelf/permissions";

import type { Organization } from "./api/types";

/**
 * Checks if a user with the given roles has permission for an entity/action.
 * Returns true if any of the user's roles grant the permission.
 *
 * Thin adapter over the shared resolver: call sites keep passing plain
 * string literals (`"asset"`, `"create"`), which the shared package accepts
 * as template-literal types of its enums.
 *
 * @param roles - The user's org-role strings as returned by `/me`.
 * @param workspace - The current organization from `/me`, whose permission
 *   switches (`managersCanEditAssets`) widen the matrix. Required so no entry
 *   point can forget them; `null` while loading reads as every switch off.
 * @param entity - The permission entity being checked.
 * @param action - The action being checked on that entity.
 * @param workspaceGrants - `false` answers from the matrix alone, for UI
 *   whose server route opts out of the switches the same way.
 * @returns `true` when any held role grants the action on the entity.
 * @throws Never — unknown roles/entities safely resolve to `false`.
 */
export function userHasPermission({
  roles,
  workspace,
  entity,
  action,
  workspaceGrants,
}: {
  roles: string[] | undefined;
  workspace: Pick<Organization, "managersCanEditAssets"> | null | undefined;
  entity: `${PermissionEntity}`;
  action: `${PermissionAction}`;
  workspaceGrants?: boolean;
}): boolean {
  return roleHasPermission({
    roles,
    entity,
    action,
    // An older server sends no switch: read it as off, which only under-offers.
    workspace: {
      managersCanEditAssets: workspace?.managersCanEditAssets === true,
    },
    workspaceGrants,
  });
}
