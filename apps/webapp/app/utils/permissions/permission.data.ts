/**
 * Permission vocabulary + role matrix — thin re-export shim.
 *
 * The canonical source moved to the shared `@shelf/permissions` workspace
 * package so the webapp (server + client validators) and the mobile
 * companion resolve permissions from ONE definition (see PR #2753
 * discussion). This shim exists so the ~250 existing
 * `~/utils/permissions/permission.data` imports keep working unchanged.
 *
 * Type note: `@shelf/permissions` deliberately has no Prisma dependency
 * (it must bundle for React Native), so its `OrganizationRole` is a plain
 * string-literal union value-identical to Prisma's `OrganizationRoles`.
 * The compile-time assertion below guarantees the two can never drift
 * silently: if Prisma adds/renames a role, this file stops typechecking.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import type { OrganizationRole } from "@shelf/permissions";

export {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "@shelf/permissions";

/**
 * Compile-time parity guard: Prisma's OrganizationRoles and the package's
 * OrganizationRole must be mutually assignable. If either side gains,
 * loses, or renames a role, one of these two lines fails to typecheck.
 */
type AssertRolesCoverPrisma = OrganizationRoles extends OrganizationRole
  ? true
  : never;
type AssertPrismaCoversRoles = OrganizationRole extends OrganizationRoles
  ? true
  : never;
// why: consts (not just types) so the assertions can't be tree-shaken out
// of typechecking by an unused-type lint fix.
const _rolesCoverPrisma: AssertRolesCoverPrisma = true;
const _prismaCoversRoles: AssertPrismaCoversRoles = true;
void _rolesCoverPrisma;
void _prismaCoversRoles;
