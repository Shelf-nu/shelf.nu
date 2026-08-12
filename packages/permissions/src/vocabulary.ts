/**
 * `@shelf/permissions` — the permission vocabulary.
 *
 * The two enums every authorization decision is expressed in. String values
 * are the lookup keys used by the matrix, so a member and its value must
 * change together or not at all.
 */

/**
 * Every action a role can be granted on an entity. String values are the
 * stable wire/lookup keys — renaming one silently changes matrix lookups, so
 * change the member name and the value together or not at all.
 */
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
/**
 * Every resource a permission can be checked against. Each role's matrix
 * entry must list ALL of these (the `Record<PermissionEntity, …>` below makes
 * that a compile error rather than a runtime `undefined` lookup).
 */
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
