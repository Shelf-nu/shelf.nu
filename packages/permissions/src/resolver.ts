/**
 * `@shelf/permissions` — the pure permission resolver.
 *
 * The one function every authorization decision in both apps resolves
 * through. Kept free of Prisma, Node APIs and any error type so React Native
 * can bundle it: callers supply `roles` and translate the boolean into their
 * own error dialect.
 */
import { Role2PermissionMap } from "./matrix";
import type { PermissionAction, PermissionEntity } from "./vocabulary";
import type { WorkspaceGrantSettings } from "./workspace-grants";
import { workspaceGrantedActions } from "./workspace-grants";

/**
 * Pure permission resolver — the effective authorization rule shared by the
 * webapp server validator and the companion's UI gating.
 *
 * Encodes every part of Shelf's rule:
 * 1. ADMIN / OWNER short-circuit to allow-all; the matrix entries of those
 *    two roles are never read.
 * 2. Matrix lookup for the remaining roles.
 * 3. The workspace switches that are on (`WORKSPACE_GRANTS`), unioned with
 *    the matrix entry of each held role.
 *
 * Accepts plain strings for roles/entity/action so React Native call sites
 * can pass literals and the webapp can pass its enum values (string enums
 * and their literal values are runtime-identical here).
 *
 * @param roles - The user's role names for the organization. Unknown or
 *   empty values safely resolve to `false` (deny).
 * @param entity - The permission entity being checked.
 * @param action - The action being checked on that entity. An array means
 *   ANY-match: `true` when a held role grants at least one of them. An empty
 *   array grants nothing (except to ADMIN/OWNER, who short-circuit first).
 * @param workspace - The workspace's switches. Absent or `null` means every
 *   switch off: the matrix answer alone.
 * @param workspaceGrants - `false` ignores `workspace` and answers from the
 *   matrix alone. For routes that share an entity/action pair with a granted
 *   path but must stay closed to whoever the switch opens it for.
 * @returns `true` when any held role grants the action on the entity.
 * @throws Never — pure function; malformed input denies instead of throwing.
 */
export function roleHasPermission({
  roles,
  entity,
  action,
  workspace,
  workspaceGrants = true,
}: {
  roles: readonly string[] | undefined;
  entity: PermissionEntity | `${PermissionEntity}`;
  action:
    | PermissionAction
    | `${PermissionAction}`
    | readonly (PermissionAction | `${PermissionAction}`)[];
  workspace?: WorkspaceGrantSettings | null;
  workspaceGrants?: boolean;
}): boolean {
  if (!roles?.length) return false;

  // Owner and admin can do anything: part of the effective rule, not the map.
  if (roles.includes("ADMIN") || roles.includes("OWNER")) return true;

  // why: `typeof === "string"` (not Array.isArray) discriminates the single
  // action from the array — PermissionAction is a STRING enum, so its members
  // are strings at runtime, and this narrows the readonly array cleanly.
  const actionsToCheck: readonly string[] =
    typeof action === "string" ? [action] : action;

  const switches = workspaceGrants ? workspace : null;

  return roles.some((role) => {
    // why: index by plain string — runtime keys are the literal role names;
    // unknown role strings fall through to undefined → deny.
    const entityPermMap = (
      Role2PermissionMap as Partial<
        Record<string, Record<string, PermissionAction[]>>
      >
    )[role];
    if (!entityPermMap) return false;
    const granted: readonly string[] = [
      ...(entityPermMap[entity] ?? []),
      ...workspaceGrantedActions({ role, entity, workspace: switches }),
    ];
    return granted.some((permission) => actionsToCheck.includes(permission));
  });
}
