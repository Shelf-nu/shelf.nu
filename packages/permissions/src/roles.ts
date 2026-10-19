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
 * One plain sentence on what each role may do, shown under the role's name
 * wherever a person picks a role (the invite and change-role dialogs). Each
 * sentence summarises that role's row in `ROLE_POLICIES` and the permission
 * matrix; keep the two in step when a role's reach changes.
 */
export const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  OWNER:
    "Everything an Administrator can do, plus billing, add-ons and ownership of the workspace.",
  ADMIN:
    "Manages everything in the workspace: assets, bookings, custody, audits, settings and the team.",
  MANAGER:
    "Runs bookings, custody and audits for everyone, but cannot create, edit or delete assets, or change workspace settings or the team.",
  SELF_SERVICE:
    "Books assets and checks them out and in for themselves, and by default sees only their own bookings and custody.",
  BASE: "Requests assets through bookings that an Administrator or Manager checks out, and by default sees only their own bookings.",
};

/**
 * The plural name of each role, for copy that names a group of people
 * ("owners, administrators and managers"). Spelled out per role because not
 * every label pluralizes by adding an "s" ("Self service users", not "Self
 * services").
 */
export const ROLE_PLURAL_LABELS: Record<OrganizationRole, string> = {
  OWNER: "Owners",
  ADMIN: "Administrators",
  MANAGER: "Managers",
  SELF_SERVICE: "Self service users",
  BASE: "Base users",
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
