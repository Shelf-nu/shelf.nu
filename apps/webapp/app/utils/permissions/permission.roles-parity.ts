/**
 * Prisma ↔ `@shelf/permissions` role parity guard.
 *
 * `@shelf/permissions` re-declares the organization role names as a plain
 * string-literal union instead of importing Prisma's `OrganizationRoles`.
 * That is deliberate and load-bearing: `@prisma/client` is a value import that
 * pulls a native query engine binary, which Metro cannot bundle for React
 * Native — so the package would stop being consumable by the companion app.
 *
 * The cost of that decision is a hand-maintained duplicate, and this file is
 * what stops it drifting. The two assertions below fail to compile if either
 * side gains, loses, or renames a role, so drift is a typecheck error rather
 * than a runtime surprise. `permission.roles-parity.test.ts` covers the same
 * ground at runtime, with a failure message that actually names the offending
 * role — read that one first when this file starts erroring.
 *
 * Nothing imports this module; it exists to be typechecked.
 *
 * @see {@link file://../../../../../packages/permissions/src/roles.ts}
 * @see {@link file://./permission.roles-parity.test.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import type { OrganizationRole } from "@shelf/permissions";

/** Fails when Prisma has a role the package is missing. */
type AssertRolesCoverPrisma = OrganizationRoles extends OrganizationRole
  ? true
  : never;

/** Fails when the package has a role Prisma is missing. */
type AssertPrismaCoversRoles = OrganizationRole extends OrganizationRoles
  ? true
  : never;

// why: consts (not just types) so the assertions can't be tree-shaken out of
// typechecking by an unused-type lint fix. `void` keeps no-unused-vars happy.
const _rolesCoverPrisma: AssertRolesCoverPrisma = true;
const _prismaCoversRoles: AssertPrismaCoversRoles = true;
void _rolesCoverPrisma;
void _prismaCoversRoles;
