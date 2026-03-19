/**
 * Client-side permission helpers for the mobile companion app.
 *
 * Mirrors the webapp's Role2PermissionMap to determine which UI actions
 * a user can see based on their organization role. These checks are
 * purely cosmetic (hide/show UI) — the server enforces permissions
 * via requireMobilePermission on every API call.
 */

type PermissionEntity = "asset" | "booking" | "audit";
type PermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "custody"
  | "checkout"
  | "checkin";

/**
 * Simplified permission map matching the webapp's Role2PermissionMap.
 * Only includes entities/actions relevant to mobile scanner actions.
 */
const ROLE_PERMISSIONS: Record<
  string,
  Record<PermissionEntity, PermissionAction[]>
> = {
  OWNER: {
    asset: ["read", "create", "update", "delete", "custody"],
    booking: ["read", "create", "update", "delete", "checkout", "checkin"],
    audit: ["read", "create", "update", "delete"],
  },
  ADMIN: {
    asset: ["read", "create", "update", "delete", "custody"],
    booking: ["read", "create", "update", "delete", "checkout", "checkin"],
    audit: ["read", "create", "update", "delete"],
  },
  SELF_SERVICE: {
    asset: ["read", "custody"],
    booking: ["read", "create", "update", "checkout", "checkin"],
    audit: ["read", "update"],
  },
  BASE: {
    asset: ["read"],
    booking: ["read"],
    audit: ["read"],
  },
};

/**
 * Checks if a user with the given roles has permission for an entity/action.
 * Returns true if any of the user's roles grant the permission.
 */
export function userHasPermission({
  roles,
  entity,
  action,
}: {
  roles: string[] | undefined;
  entity: PermissionEntity;
  action: PermissionAction;
}): boolean {
  if (!roles?.length) return false;

  return roles.some((role) => {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;
    return perms[entity]?.includes(action) ?? false;
  });
}
