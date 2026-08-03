/**
 * @shelf/permissions — the single source of truth for Shelf's RBAC rules.
 *
 * Owns the permission vocabulary (PermissionAction / PermissionEntity), the
 * role → permission matrix (Role2PermissionMap), and the pure resolution
 * logic (roleHasPermission) that turns (roles, entity, action) into a
 * boolean — INCLUDING the ADMIN/OWNER allow-all short-circuit that is part
 * of Shelf's effective authorization behavior but never appeared in the raw
 * matrix.
 *
 * Consumed by:
 * - webapp server validator (~/utils/permissions/permission.validator.server.ts)
 * - webapp permission.data shim (~/utils/permissions/permission.data.ts)
 * - companion UI gating (apps/companion/lib/permissions.ts)
 *
 * Deliberately dependency-free (no Prisma, no Node APIs) so Metro can bundle
 * it for React Native: OrganizationRole re-declares the role names as a
 * plain string-literal union, value-identical to Prisma's OrganizationRoles
 * enum (compile-time assignable in the webapp; asserted by tests there).
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

export enum PermissionAction {
  create = "create",
  read = "read",
  update = "update",
  delete = "delete",
  checkout = "checkout",
  checkin = "checkin",
  export = "export",
  import = "import",
  archive = "archive",
  cancel = "cancel",
  extend = "extend",
  manageAssets = "manage-assets",
  custody = "custody",
  manageKits = "manage-kits",
  changeRole = "change-role",
}
export enum PermissionEntity {
  asset = "asset",
  assetIndexSettings = "assetIndexSettings",
  qr = "qr",
  booking = "booking",
  bookingNote = "bookingNote",
  tag = "tag",
  category = "category",
  location = "location",
  locationNote = "locationNote",
  customField = "customField",
  workspace = "workspace",
  teamMember = "teamMember",
  teamMemberProfile = "teamMemberProfile",
  dashboard = "dashboard",
  generalSettings = "generalSettings",
  workingHours = "workingHours",
  subscription = "subscription",
  kit = "kit",
  note = "note",
  scan = "scan",
  custody = "custody",
  assetReminders = "assetReminders",
  audit = "audit",
  auditNote = "auditNote",
  teamMemberNote = "teamMemberNote",
  assetModel = "assetModel",
  emailSettings = "emailSettings",
  userData = "user-data", // This is for the user to load their own data.
  update = "update",
  commandPaletteSearch = "command-palette-search",
}

export const Role2PermissionMap: {
  [K in OrganizationRole]?: Record<PermissionEntity, PermissionAction[]>;
} = {
  BASE: {
    [PermissionEntity.asset]: [PermissionAction.read],
    [PermissionEntity.assetIndexSettings]: [PermissionAction.read],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete, // This is for the user to delete their own bookings only when they are draft.
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.audit]: [PermissionAction.read, PermissionAction.update],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [],
    [PermissionEntity.customField]: [],
    [PermissionEntity.location]: [],
    [PermissionEntity.locationNote]: [],
    [PermissionEntity.tag]: [],
    [PermissionEntity.teamMember]: [],
    [PermissionEntity.teamMemberProfile]: [],
    [PermissionEntity.workspace]: [],
    [PermissionEntity.dashboard]: [],
    [PermissionEntity.generalSettings]: [],
    [PermissionEntity.workingHours]: [PermissionAction.read],
    [PermissionEntity.subscription]: [],
    [PermissionEntity.kit]: [PermissionAction.read],
    [PermissionEntity.note]: [],
    [PermissionEntity.scan]: [],
    [PermissionEntity.custody]: [],
    [PermissionEntity.assetReminders]: [],
    [PermissionEntity.teamMemberNote]: [],
    [PermissionEntity.assetModel]: [PermissionAction.read],
    [PermissionEntity.emailSettings]: [],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
  SELF_SERVICE: {
    [PermissionEntity.asset]: [PermissionAction.read, PermissionAction.custody],
    [PermissionEntity.assetIndexSettings]: [PermissionAction.read],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.checkout,
      PermissionAction.checkin,
      PermissionAction.delete, // This is for the user to delete their own bookings only when they are draft.
      PermissionAction.archive,
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.cancel,
      PermissionAction.extend,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
    ],
    [PermissionEntity.audit]: [PermissionAction.read, PermissionAction.update],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [],
    [PermissionEntity.customField]: [],
    [PermissionEntity.location]: [],
    [PermissionEntity.locationNote]: [],
    [PermissionEntity.tag]: [],
    [PermissionEntity.teamMember]: [],
    [PermissionEntity.teamMemberProfile]: [],
    [PermissionEntity.workspace]: [],
    [PermissionEntity.dashboard]: [],
    [PermissionEntity.generalSettings]: [],
    [PermissionEntity.workingHours]: [PermissionAction.read],
    [PermissionEntity.subscription]: [],
    [PermissionEntity.kit]: [PermissionAction.read, PermissionAction.custody],
    [PermissionEntity.note]: [],
    [PermissionEntity.scan]: [],
    [PermissionEntity.custody]: [],
    [PermissionEntity.assetReminders]: [],
    [PermissionEntity.teamMemberNote]: [],
    [PermissionEntity.assetModel]: [],
    [PermissionEntity.emailSettings]: [],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
  ADMIN: {
    [PermissionEntity.asset]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
      PermissionAction.import,
      PermissionAction.export,
    ],
    [PermissionEntity.assetIndexSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.checkout,
      PermissionAction.checkin,
      PermissionAction.archive,
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.cancel,
      PermissionAction.extend,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.customField]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.location]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.locationNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.tag]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.teamMember]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.changeRole,
    ],
    [PermissionEntity.teamMemberProfile]: [PermissionAction.read],
    [PermissionEntity.workspace]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.dashboard]: [PermissionAction.read],
    [PermissionEntity.generalSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.workingHours]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.subscription]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.kit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
    ],
    [PermissionEntity.note]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.scan]: [PermissionAction.read],
    [PermissionEntity.custody]: [PermissionAction.read],
    [PermissionEntity.assetReminders]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.audit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.archive,
    ],
    [PermissionEntity.teamMemberNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.assetModel]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.emailSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
  OWNER: {
    [PermissionEntity.asset]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
      PermissionAction.import,
      PermissionAction.export,
    ],
    [PermissionEntity.assetIndexSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.checkout,
      PermissionAction.checkin,
      PermissionAction.archive,
      PermissionAction.manageAssets,
      PermissionAction.manageKits,
      PermissionAction.cancel,
      PermissionAction.extend,
      PermissionAction.export,
    ],
    [PermissionEntity.bookingNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.auditNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.qr]: [PermissionAction.read],
    [PermissionEntity.category]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.customField]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.location]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.locationNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.tag]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.teamMember]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.changeRole,
    ],
    [PermissionEntity.teamMemberProfile]: [PermissionAction.read],
    [PermissionEntity.workspace]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.dashboard]: [PermissionAction.read],
    [PermissionEntity.generalSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.workingHours]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.subscription]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.kit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.custody,
    ],
    [PermissionEntity.note]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.scan]: [PermissionAction.read],
    [PermissionEntity.custody]: [PermissionAction.read],
    [PermissionEntity.assetReminders]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.audit]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
      PermissionAction.archive,
    ],
    [PermissionEntity.teamMemberNote]: [
      PermissionAction.read,
      PermissionAction.create,
      PermissionAction.delete,
    ],
    [PermissionEntity.assetModel]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete,
    ],
    [PermissionEntity.emailSettings]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.userData]: [
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.update]: [PermissionAction.read],
    [PermissionEntity.commandPaletteSearch]: [PermissionAction.read],
  },
};

/**
 * Pure permission resolver — the effective authorization rule shared by the
 * webapp server validator and the companion's UI gating.
 *
 * Encodes BOTH halves of Shelf's behavior:
 * 1. ADMIN / OWNER short-circuit to allow-all (historically lived only in
 *    the webapp's `hasPermission`, never in the matrix itself).
 * 2. Matrix lookup for the remaining roles.
 *
 * Accepts plain strings for roles/entity/action so React Native call sites
 * can pass literals and the webapp can pass its enum values (string enums
 * and their literal values are runtime-identical here).
 *
 * @param roles - The user's role names for the organization. Unknown or
 *   empty values safely resolve to `false` (deny).
 * @param entity - The permission entity being checked.
 * @param action - The action being checked on that entity.
 * @returns `true` when any held role grants the action on the entity.
 * @throws Never — pure function; malformed input denies instead of throwing.
 */
export function roleHasPermission({
  roles,
  entity,
  action,
}: {
  roles: readonly string[] | undefined;
  entity: PermissionEntity | `${PermissionEntity}`;
  action: PermissionAction | `${PermissionAction}`;
}): boolean {
  if (!roles?.length) return false;

  // Owner and admin can do anything (mirrors the webapp's historical
  // hasPermission short-circuit — part of effective behavior, not the map).
  if (roles.includes("ADMIN") || roles.includes("OWNER")) return true;

  return roles.some((role) => {
    // why: index by plain string — runtime keys are the literal role names;
    // unknown role strings fall through to undefined → deny.
    const entityPermMap = (
      Role2PermissionMap as Partial<
        Record<string, Record<string, PermissionAction[]>>
      >
    )[role];
    if (!entityPermMap) return false;
    return entityPermMap[entity]?.includes(action as PermissionAction) ?? false;
  });
}
