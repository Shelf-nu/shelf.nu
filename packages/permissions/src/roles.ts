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
  "MANAGER",
  "SELF_SERVICE",
  "BASE",
] as const;

/** A single organization role name. */
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** The human name of each role, used wherever a role is shown to people. */
export const ROLE_LABELS: Record<OrganizationRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  MANAGER: "Manager",
  SELF_SERVICE: "Self service",
  BASE: "Base",
};

/**
 * Whether a value is one of the known organization role names.
 *
 * @param value - Anything, typically an element of a membership's role array
 * @returns `true` for a known role name
 */
export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === "string" &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
  );
}
