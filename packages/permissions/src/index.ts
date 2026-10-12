/**
 * `@shelf/permissions` — the single source of truth for Shelf's RBAC rules.
 *
 * Owns the permission vocabulary (`PermissionAction` / `PermissionEntity`),
 * the role-to-permission matrix, and the pure resolution logic
 * (`roleHasPermission`) that turns (roles, entity, action) into a boolean,
 * INCLUDING the ADMIN/OWNER allow-all short-circuit that is part of Shelf's
 * effective authorization behavior but never appeared in the raw matrix.
 *
 * Also owns the role policy table (`ROLE_POLICIES`) and `resolveRoleAccess`,
 * which answer how far a role reaches beyond the matrix: whose bookings,
 * whose custody, which audits, which limits apply, and who hears about what,
 * folded with the workspace's visibility toggles.
 *
 * Consumed by:
 * - webapp server validator (~/utils/permissions/permission.validator.server.ts)
 * - webapp client UI gating (~/utils/permissions/permission.validator.client.ts)
 * - companion UI gating (apps/companion/lib/permissions.ts)
 *
 * There is no other copy: every RBAC decision in either app resolves here.
 *
 * Deliberately dependency-free (no Prisma, no Node APIs) so Metro can bundle
 * it for React Native. See `./roles` for why the role union is re-declared
 * rather than imported from Prisma.
 *
 * This module is re-exports only — public API surface lives here, the
 * implementations live in the sibling modules.
 */

export { ORGANIZATION_ROLES, ROLE_LABELS, isOrganizationRole } from "./roles";
export type { OrganizationRole } from "./roles";
export { PermissionAction, PermissionEntity } from "./vocabulary";
export { Role2PermissionMap } from "./matrix";
export { roleHasPermission } from "./resolver";
export {
  BOOKING_STATUS_NAMES,
  INVITABLE_ROLES,
  ROLE_POLICIES,
  ROLES_BY_RANK,
  SSO_ASSIGNABLE_ROLES,
} from "./policies";
export type { BookingStatusName, RolePolicy } from "./policies";
export { resolveRole } from "./resolve-role";
export {
  canManageBookingItems,
  canPartialCheckInOut,
  canRemoveBookingItems,
  isExplicitScanRequired,
  isWorkspaceOwner,
  labelToRole,
  resolveRoleAccess,
  rolesWhere,
  transfersBookingsOnRoleChange,
  transfersOwnershipOnRoleChange,
} from "./access";
export type {
  ExplicitScanSettings,
  RoleAccess,
  WorkspaceAccessSettings,
} from "./access";
