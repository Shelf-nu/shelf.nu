/**
 * `@shelf/permissions` — organization role names.
 *
 * Deliberately NOT derived from Prisma's `OrganizationRoles`: `@prisma/client`
 * is a value import that pulls a native query engine binary, which Metro
 * cannot bundle for React Native. The two are kept in lockstep instead by a
 * bidirectional compile-time assertion plus a runtime parity test in the
 * webapp — see `apps/webapp/app/utils/permissions/permission.roles-parity.ts`.
 */

/**
 * Organization role names, value-identical to Prisma's `OrganizationRoles`.
 * Re-declared here so this package stays free of `@prisma/client` (which
 * cannot be bundled into the companion app).
 */
export const ORGANIZATION_ROLES = [
  "OWNER",
  "ADMIN",
  "SELF_SERVICE",
  "BASE",
] as const;

/** A single organization role name. */
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
