/**
 * Role access, the webapp's single entry point to the role policy API.
 *
 * Re-exports the policy table, `resolveRoleAccess` and its helpers from
 * `@shelf/permissions`. Webapp code imports from here, never from the package
 * directly: direct imports from many files push the webapp over TypeScript's
 * type-instantiation limit, and the resulting TS2321 lands on an unrelated
 * Prisma query (see `permission.data.ts`, the same shim for the matrix).
 *
 * @see {@link file://../../../../../packages/permissions/src/access.ts}
 */
export {
  BOOKING_STATUS_NAMES,
  INVITABLE_ROLES,
  ROLE_LABELS,
  ROLE_POLICIES,
  ROLES_BY_RANK,
  SSO_ASSIGNABLE_ROLES,
  canManageBookingItems,
  canPartialCheckInOut,
  canRemoveBookingItems,
  isExplicitScanRequired,
  isOrganizationRole,
  isWorkspaceOwner,
  labelToRole,
  resolveRole,
  resolveRoleAccess,
  rolesWhere,
  transfersBookingsOnRoleChange,
  transfersOwnershipOnRoleChange,
} from "@shelf/permissions";
export type {
  BookingStatusName,
  ExplicitScanSettings,
  OrganizationRole,
  RoleAccess,
  RolePolicy,
  WorkspaceAccessSettings,
} from "@shelf/permissions";
