/**
 * `@shelf/permissions` — the single source of truth for Shelf's RBAC rules.
 *
 * Owns the permission vocabulary (`PermissionAction` / `PermissionEntity`),
 * the role → permission matrix, and the pure resolution logic
 * (`roleHasPermission`) that turns (roles, entity, action) into a boolean —
 * INCLUDING the ADMIN/OWNER allow-all short-circuit that is part of Shelf's
 * effective authorization behavior but never appeared in the raw matrix.
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

export { ORGANIZATION_ROLES } from "./roles";
export type { OrganizationRole } from "./roles";
export { PermissionAction, PermissionEntity } from "./vocabulary";
export { Role2PermissionMap } from "./matrix";
export { roleHasPermission } from "./resolver";
