/**
 * @shelf/labels — canonical user-facing label strings.
 *
 * Single source of truth for status/booking terminology shared by BOTH the
 * webapp (`apps/webapp`) and the companion app (`apps/companion`). Plain ESM
 * JS + a hand-written `index.d.ts` (no build step) so it loads unchanged in
 * Vite (web) and Metro (React Native) — Metro does not transform TS inside
 * node_modules, so this file is authored as .js on purpose. It is authored as
 * ESM (matching the `@shelf/database` sibling): Vite 7's dev-SSR module runner
 * evaluates inlined modules as ES modules and has no CommonJS `module` global,
 * so a `module.exports` here 500s the whole webapp dev server. Metro's Babel
 * transform lowers these `export const`s to CJS at bundle time, so RN is fine.
 *
 * Rule: never hard-code a status label string in either app. Import it here.
 * Web `userFriendlyAssetStatus` / `getQuantityBadgeLabelAndColor` and companion
 * `formatStatus` all read from these maps, so the phone can never show a
 * different word than the website.
 */

// Base asset status enum (AssetStatus in the Prisma schema).
export const ASSET_STATUS_LABELS = Object.freeze({
  AVAILABLE: "Available",
  IN_CUSTODY: "In custody",
  CHECKED_OUT: "Checked out",
});

// Quantity-aware asset status labels. A QUANTITY_TRACKED asset whose units are
// split across states derives its badge from the quantity breakdown, not the
// raw enum. These are the labels that helper can emit (web canonical: the
// quantity path in asset-status-badge/quantity-data.ts).
export const ASSET_QTY_STATUS_LABELS = Object.freeze({
  AVAILABLE: "Available",
  IN_CUSTODY: "In custody",
  PARTIAL_CUSTODY: "Partial custody",
  CHECKED_OUT: "Checked out",
  PARTIALLY_CHECKED_OUT: "Partially checked out",
  RESERVED: "Reserved",
  PARTIALLY_RESERVED: "Partially reserved",
});

// Labels for the quantity FIGURES on a pool (not its status badge).
//
// `FREE_NOW` is the physical count: total minus custody, kits and checked-out.
// It is deliberately NOT called "Available", three different things in this
// product were called that at once (this figure, the `Available` status badge,
// and the `Available to book` flag), and only this one is time-bound. Without
// the word "now" a row reading "Available 10" beside "Reserved 12" looks like a
// contradiction rather than two facts about different moments.
//
// It lives here because the figure is rendered on the assets index, the asset
// page, the reports PDF and the mobile asset screen. Renaming it in one place
// and not the others is worse than not renaming it at all: the same number ends
// up with two names in one product. One constant, one edit.
export const ASSET_QUANTITY_FIGURE_LABELS = Object.freeze({
  TOTAL: "Total quantity",
  FREE_NOW: "Free now",
  IN_CUSTODY: "In custody",
  RESERVED: "Reserved",
});

// Booking-context pseudo-statuses an asset row can show inside a booking
// (web canonical: the enum path in asset-status-badge/status-labels.ts).
export const ASSET_BOOKING_PSEUDO_STATUS_LABELS = Object.freeze({
  ALREADY_CHECKED_IN: "Already checked in",
  PARTIALLY_CHECKED_IN: "Partially checked in",
  PARTIALLY_CHECKED_OUT: "Partially checked out",
});

/**
 * How a kit's state is named, on the website and on the phone.
 *
 * - `AVAILABLE` — "Available": free to book or take.
 * - `IN_CUSTODY` — "In custody": someone is holding it.
 * - `CHECKED_OUT` — "Checked out": it is out on a booking.
 * - `PARTIALLY_CHECKED_IN` — "Already checked in".
 *
 * The first three are the persisted `KitStatus` enum. The fourth is not stored
 * anywhere: a booking derives it for a kit whose every member it holds has been
 * checked back in while the booking is still running. It reuses the asset
 * wording deliberately, so a kit and the members listed under it never describe
 * the same state in different words on one screen.
 *
 * The three enum entries are spelled out rather than spread from
 * {@link ASSET_STATUS_LABELS}, and must stay that way: `KitStatus` and
 * `AssetStatus` are separate database enums that happen to name the same three
 * states, and this map's KEY SET has to track `KitStatus` alone — a member
 * added to one enum has no business appearing on the other's badges. Their
 * WORDING, on the other hand, must match, because a booking lists a kit and the
 * assets inside it on one screen. The "a kit and an asset are named alike" test
 * holds those three strings together: reword both maps, or neither.
 */
export const KIT_STATUS_LABELS = Object.freeze({
  AVAILABLE: "Available",
  IN_CUSTODY: "In custody",
  CHECKED_OUT: "Checked out",
  PARTIALLY_CHECKED_IN: ASSET_BOOKING_PSEUDO_STATUS_LABELS.ALREADY_CHECKED_IN,
});

// Booking status enum (BookingStatus in the Prisma schema).
export const BOOKING_STATUS_LABELS = Object.freeze({
  DRAFT: "Draft",
  RESERVED: "Reserved",
  ONGOING: "Ongoing",
  OVERDUE: "Overdue",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
  CANCELLED: "Cancelled",
});

// Audit session status enum (AuditStatus in the Prisma schema).
export const AUDIT_STATUS_LABELS = Object.freeze({
  PENDING: "Pending",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
});

// Who may act on an audit that has no specific assignee. One idea, three
// registers — a compact card line, the screen-reader variant that gets joined
// into a comma-separated announcement, and the prose used where there is room
// to explain (the web's "Not assigned" tooltip). They live together so the
// three can never say different things about who is allowed to scan.
//
// All three name every role that sees all audits (`audits.scope === "all"` in
// the role policy), because requireAuditAssignee lets exactly those roles scan
// an audit nobody is assigned to: owners, admins and managers.
// Pinned by the AUDIT_UNASSIGNED_LABELS tests in the webapp.
export const AUDIT_UNASSIGNED_LABELS = Object.freeze({
  SHORT: "Unassigned · owners, admins and managers can scan",
  A11Y: "unassigned, owners, admins and managers can scan",
  DETAIL:
    "Workspace owners, admins and managers can perform this audit because it has no specific assignee.",
});

// Per-asset audit status (AuditAssetStatus in the Prisma schema).
//
// PENDING reads "Not scanned" rather than "Expected": "Expected" is the name of
// the statistics tile that counts EVERY asset the audit covers, so the
// not-yet-scanned subset needs a word of its own.
//
// MISSING is only true once the audit is completed — that is when the
// completion flow turns unscanned rows into MISSING. Before completion, use
// PENDING's label. `auditAssetStatusLabel` below encodes that rule; call it
// instead of indexing this map directly.
export const AUDIT_ASSET_STATUS_LABELS = Object.freeze({
  PENDING: "Not scanned",
  FOUND: "Found",
  MISSING: "Missing",
  UNEXPECTED: "Unexpected",
});

/**
 * Wording for an audit scan whose asset no longer exists.
 *
 * Deleting an asset leaves the scan row behind with nothing to name it but the
 * title captured at scan time, so these two strings are the only thing standing
 * between an auditor and an anonymous row. Both apps must say it the same way:
 * an audit is a historical record, and two surfaces describing the same
 * surviving row differently is exactly the drift this package exists to stop.
 *
 * `UNTITLED` covers a row scanned before the title was recorded by value —
 * there is no name left to qualify, so the row says only what it is.
 */
export const AUDIT_DELETED_ASSET_LABELS = Object.freeze({
  UNTITLED: "Deleted asset",
});

/**
 * Names a scan whose asset has been deleted, keeping the title it had when it
 * was scanned and marking it as gone.
 *
 * @param {string | null | undefined} title - the snapshotted title, if any
 * @returns {string} the row's display name
 */
export function auditDeletedAssetLabel(title) {
  const trimmed = typeof title === "string" ? title.trim() : "";
  return trimmed ? `${trimmed} (deleted)` : AUDIT_DELETED_ASSET_LABELS.UNTITLED;
}

/**
 * The ONE derivation of the "is this audit concluded?" flag every audit label
 * depends on. Read `completedAt`, never `status`.
 *
 * why: `completedAt` is the provenance — it is written only by the completion
 * flow and survives everything that happens afterwards. `status` does not:
 * archiving a completed audit rewrites it to ARCHIVED while keeping the
 * timestamp and the finalised counts, so a status check silently relabels
 * genuinely missing assets as "Not scanned" the moment someone archives. The
 * inverse holds too — an archived-CANCELLED audit was never concluded, and
 * `completedAt` correctly keeps it on the open-audit wording.
 *
 * Both apps and every surface within them must agree, so the rule lives here
 * next to the strings it feeds rather than being re-derived per component.
 *
 * @param {{ completedAt?: Date | string | null } | null | undefined} audit
 * @returns {boolean}
 */
export function isAuditCompleted(audit) {
  return audit?.completedAt != null;
}

/**
 * Resolves the user-facing label for an expected-but-unscanned asset.
 *
 * Nothing is "missing" until the audit is closed: while it is still running the
 * asset simply has not been reached yet. Both apps must apply this rule, so it
 * lives here next to the strings rather than in either app.
 *
 * @param {"PENDING"|"FOUND"|"MISSING"|"UNEXPECTED"} status
 * @param {boolean} isAuditCompleted - derive with {@link isAuditCompleted}
 * @returns {string}
 */
export function auditAssetStatusLabel(status, isAuditCompleted) {
  if (status === "PENDING") {
    return isAuditCompleted
      ? AUDIT_ASSET_STATUS_LABELS.MISSING
      : AUDIT_ASSET_STATUS_LABELS.PENDING;
  }
  return AUDIT_ASSET_STATUS_LABELS[status];
}

// Why a booking cannot be reserved yet: the rules web's Reserve button
// disables on, in one register for every surface that states them: the web
// tooltip, the mobile route's 400, the in-transaction guard's 400 and the
// companion's client-side note.
//
// These are the *reasons the button is blocked*, not the outcome of a failed
// write: `reserveBooking`'s race-safe conflict check names the specific
// offending assets and deliberately keeps its own richer message.
export const BOOKING_RESERVE_BLOCKED_LABELS = Object.freeze({
  NOTHING_TO_RESERVE:
    "Add assets or reserve at least one model on this booking before you reserve it.",
  UNAVAILABLE_ASSETS:
    "This booking holds assets marked as unavailable. Remove them, or make them available again, before reserving.",
  ALREADY_BOOKED:
    "This booking holds assets already booked for that period. Remove them, or change the dates, before reserving.",
  START_PASSED: "The start time has passed. Move it later to reserve.",
});

// Refusal shown when emptying a RESERVED booking. Such a booking with nothing
// in it reserves nothing — the very state the Reserve guards exist to prevent —
// so the removal paths defend the same invariant rather than letting users
// reach it from the other side.
//
// RESERVED only, deliberately. An empty DRAFT is normal work-in-progress; a
// COMPLETE / ARCHIVED / CANCELLED booking is not holding anything any more; and
// ONGOING / OVERDUE bookings must stay emptiable, because pulling a
// checked-out asset off a live booking is a real correction flow (the service
// reconciles the asset's status when it happens).
export const BOOKING_EMPTY_RESERVED_MESSAGE =
  "A reserved booking must keep at least one asset or model reservation. Cancel the booking instead, or add a replacement first.";

// The name a booking row carries in place of a custodian the viewer may not
// see. The server sends it, the web badge draws it and the companion app draws
// it, so a withheld custodian reads the same everywhere. Distinct from `null`,
// which means the booking has no custodian at all: a client must tell the two
// apart, or an unassigned booking reads as a hidden one.
export const WITHHELD_CUSTODIAN_NAME = "private";

// Why an individually tracked asset that belongs to a kit cannot be put into
// custody on its own. Custody of such an asset comes from its kit: assign
// custody to the kit, or take the asset out of the kit first. One register for
// every surface that states the rule: the server's 400 on every assign path,
// the web asset page and assets index menus, and the companion asset screen.
//
// Quantity-tracked assets are not covered. A kit holds only a slice of a pool,
// and the units outside every kit can still be assigned on their own.
export const KIT_MEMBER_CUSTODY_BLOCKED_TITLE = "Asset is part of a kit";

/**
 * The reason a single kit member's "Assign custody" action is disabled.
 *
 * @param {string} kitName - the name of the kit the asset belongs to
 * @returns {string}
 */
export function kitMemberCustodyBlockedReason(kitName) {
  return `This asset is part of kit "${kitName}". Assign custody to the kit, or remove the asset from the kit first.`;
}

/**
 * The server's refusal when an assign request names a kit member.
 *
 * @param {{ assetTitle: string; kitName: string }} names
 * @returns {string}
 */
export function kitMemberCustodyRefusal({ assetTitle, kitName }) {
  return `"${assetTitle}" is part of kit "${kitName}". Assign custody to the kit, or remove the asset from the kit first.`;
}

/** How many kit members a refusal names before summarising the rest. */
const KIT_MEMBERS_NAMED_IN_REFUSAL = 3;

/**
 * The server's refusal when an assign request names several kit members.
 *
 * A "select all" request can hold many, and the operator cannot see which from
 * the menu, so the refusal gives the count and names the first few. One member
 * reads exactly as {@link kitMemberCustodyRefusal}.
 *
 * @param {{ assetTitle: string; kitName: string }[]} members - at least one
 * @returns {string}
 */
export function kitMembersCustodyRefusal(members) {
  if (members.length === 1) return kitMemberCustodyRefusal(members[0]);

  const named = members
    .slice(0, KIT_MEMBERS_NAMED_IN_REFUSAL)
    .map((m) => `"${m.assetTitle}"`);
  const rest = members.length - named.length;
  const list =
    rest > 0
      ? `${named.join(", ")} and ${rest} more`
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;

  return `${members.length} of the selected assets are part of a kit: ${list}. Assign custody to the kit, or remove them from the kit first.`;
}

// The reason a bulk "Assign custody" action is disabled when the selection
// holds at least one kit member.
export const KIT_MEMBERS_CUSTODY_BLOCKED_REASON =
  "Some of the selected assets are part of a kit. Assign custody to the kit, or remove them from the kit first.";

// Why "Reinstate" is refused for an archived asset whose kit is in custody or
// checked out. The kit took its hold without this member, so reinstating it
// would leave an active member the kit does not account for. Shown by the
// server refusal and by the disabled Reinstate action alike.
export const KIT_IN_USE_REINSTATE_REASON =
  "This asset belongs to a kit that is in custody or checked out. Release or check in the kit first, then reinstate the asset.";

// Archived assets (`Asset.archivedAt`) are out of service: the only changes
// allowed are reinstate and permanent delete. Reinstating needs the asset
// `archive` permission (admins and owners), so every sentence below that says
// how to fix things is worded for the person reading it. A member who cannot
// reinstate is told to ask an admin, never to use a button they do not have.
// One register for the web tooltips, the server's refusals (which the
// companion shows verbatim) and the companion's own reasons.

/** How many assets or kits a refusal names before summarising the rest. */
const NAMED_IN_ARCHIVED_REFUSAL = 3;

/**
 * Joins names for a sentence: `"A"`, `"A" and "B"`, `"A", "B", "C" and 2 more`.
 *
 * @param {string[]} names - at least one
 * @returns {string}
 */
function quotedNameList(names) {
  const named = names
    .slice(0, NAMED_IN_ARCHIVED_REFUSAL)
    .map((name) => `"${name}"`);
  const rest = names.length - named.length;
  if (rest > 0) return `${named.join(", ")} and ${rest} more`;
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * The reason an action on an archived asset is disabled.
 *
 * @param {{ canReinstate: boolean; action?: "change" | "book" }} options -
 *   `canReinstate` is whether the reader holds the asset `archive` permission
 * @returns {string}
 */
export function archivedAssetBlockedReason({
  canReinstate,
  action = "change",
}) {
  if (!canReinstate) {
    return "This asset is archived. Ask an admin to reinstate it.";
  }
  return action === "book"
    ? "This asset is archived. Reinstate it to book it."
    : "This asset is archived. Reinstate it to make changes.";
}

/**
 * The refusal when a request touches archived assets. Names them, so the
 * person can find them in a long list or a scanner batch.
 *
 * - `"reinstate"`: a change to the asset itself (edit, custody, location).
 * - `"remove-from-list"`: a batch the person built (scanner, selection). The
 *   fix that works for every role is dropping the archived rows.
 * - `"remove-from-booking"`: a booking that holds them (reserve, check-out).
 *
 * @param {{ titles: string[]; fix: "reinstate" | "remove-from-list" | "remove-from-booking"; canReinstate: boolean }} options
 * @returns {string}
 */
export function archivedAssetsRefusal({ titles, fix, canReinstate }) {
  const count = titles.length;
  const them = count === 1 ? "it" : "them";
  const subject =
    count === 0
      ? "Some of these assets are archived."
      : `${quotedNameList(titles)} ${count === 1 ? "is" : "are"} archived.`;

  switch (fix) {
    case "remove-from-list":
      return `${subject} Remove ${them} from the list and try again.`;
    case "remove-from-booking":
      return canReinstate
        ? `${subject} Remove ${them} from the booking or reinstate ${them}.`
        : `${subject} Remove ${them} from the booking or ask an admin to reinstate ${them}.`;
    default:
      return canReinstate
        ? `${subject} Reinstate ${them} to make changes.`
        : `${subject} Ask an admin to reinstate ${them}.`;
  }
}

/**
 * The sentence added to a success message when archived kit members, or
 * archived assets of a copied booking, were left out.
 *
 * @param {number} count - archived assets left out, at least one
 * @returns {string}
 */
export function archivedAssetsLeftOut(count) {
  return `${count} archived ${
    count === 1 ? "asset was" : "assets were"
  } left out.`;
}

/**
 * The refusal when kits with no active asset are put into custody or booked.
 * Such a kit would be held or booked while nothing in it is.
 *
 * @param {{ kits: { name: string; hasArchivedAssets: boolean }[]; action: "custody" | "booking" }} options
 *   - `kits`: at least one; `hasArchivedAssets` is false for an empty kit
 * @returns {string}
 */
export function kitsWithoutActiveAssetsRefusal({ kits, action }) {
  const verb = action === "custody" ? "put into custody" : "book";
  if (kits.length === 1) {
    const [kit] = kits;
    return kit.hasArchivedAssets
      ? `Kit "${kit.name}" holds only archived assets, so there is nothing to ${verb}. Add an active asset to it, or have an admin reinstate one.`
      : `Kit "${kit.name}" has no assets, so there is nothing to ${verb}. Add assets to it first.`;
  }
  return `${
    kits.length
  } kits have no active assets, so there is nothing to ${verb}: ${quotedNameList(
    kits.map((kit) => kit.name)
  )}. Add active assets to them first.`;
}

/**
 * The reason a kit's Book or custody action is disabled because the kit holds
 * no active asset.
 *
 * @param {{ hasArchivedAssets: boolean; action: "custody" | "booking" }} options
 * @returns {string}
 */
export function kitWithoutActiveAssetsReason({ hasArchivedAssets, action }) {
  const goal = action === "custody" ? "assign custody" : "book this kit";
  return hasArchivedAssets
    ? `This kit holds only archived assets. Add an active asset to ${goal}.`
    : `This kit has no assets. Add assets to ${goal}.`;
}

/**
 * The semantic weight a status badge carries, independent of any palette.
 *
 * The two apps cannot share colour VALUES — the webapp has one fixed hex
 * palette (`BADGE_COLORS`), the companion resolves every colour twice, once for
 * light mode and once for dark — so they share the DECISION instead: which
 * status deserves which weight. Each app resolves a tone against its own
 * palette, and the two resolvers must stay visually equivalent:
 *
 *   neutral → grey      no signal; nothing has happened yet
 *   info    → blue      in progress, nothing wrong
 *   success → green     the good outcome
 *   warning → amber     worth attention, nothing lost
 *   danger  → red       something is wrong and someone must act
 *
 * Resolvers: `toneBadgeColors` (`apps/webapp/app/utils/status-tone-colors.ts`)
 * and `buildToneBadge` (`apps/companion/lib/theme-colors.ts`).
 */

/** @typedef {"neutral"|"info"|"success"|"warning"|"danger"} StatusTone */

/**
 * Tone for each audit session status.
 *
 * Only a running audit (info) and a finished one (success) carry a signal; an
 * audit nobody has started yet, or one that ended without running, is neutral.
 * Urgency is not encoded here at all — both apps signal a late audit through
 * the due date beside the badge (the web adds an "Overdue" badge, the companion
 * reddens the due line), so the status badge itself stays a plain statement of
 * where the audit is.
 */
export const AUDIT_STATUS_TONES = Object.freeze({
  PENDING: "neutral",
  ACTIVE: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  ARCHIVED: "neutral",
});

/**
 * Tone for each per-asset audit outcome, read as one escalating scale: neutral
 * (not reached yet) → success (found) → warning → danger.
 *
 * MISSING outranks UNEXPECTED. An asset that should be here and is not may be
 * lost or stolen and someone has to act on it; an unexpected asset is a
 * surprise, but it is physically in the auditor's hands and merely filed wrong.
 */
export const AUDIT_ASSET_STATUS_TONES = Object.freeze({
  PENDING: "neutral",
  FOUND: "success",
  MISSING: "danger",
  UNEXPECTED: "warning",
});

/**
 * How an asset's tracking method is named, on the website and on the phone.
 *
 * These are the words the tracking-method picker shows. The CSV importer names
 * the same concepts, but a CSV cell must hold the raw enum member, so an import
 * message pairs the literal value with the label rather than replacing it.
 */
export const ASSET_TYPE_LABELS = Object.freeze({
  INDIVIDUAL: "Individually tracked",
  QUANTITY_TRACKED: "Tracked by quantity",
});

/**
 * How a quantity-tracked asset's consumption behaviour is named.
 *
 * The parenthetical restates the enum member in words, because "used up" and
 * "returnable" are the concepts while ONE_WAY and TWO_WAY are what the data
 * holds — someone reading a CSV template and someone reading the asset form
 * have to arrive at the same place.
 */
export const CONSUMPTION_TYPE_LABELS = Object.freeze({
  ONE_WAY: "Used up (one-way)",
  TWO_WAY: "Returnable (two-way)",
});

/**
 * What each consumption type means for the stock, as a clause that follows its
 * label. Kept apart from the label so a surface can show the name alone.
 */
export const CONSUMPTION_TYPE_DESCRIPTIONS = Object.freeze({
  ONE_WAY: "consumed and not returned",
  TWO_WAY: "checked out and returned",
});

/**
 * The same tracking methods used attributively, as in "quantity-tracked
 * assets". {@link ASSET_TYPE_LABELS} names the method — the title of the
 * picker card — and reads wrongly in front of a noun; this reads wrongly as a
 * title. Both are needed, and the bulk dialogs already use these words.
 */
export const ASSET_TYPE_ADJECTIVES = Object.freeze({
  INDIVIDUAL: "individually tracked",
  QUANTITY_TRACKED: "quantity-tracked",
});

/**
 * The same consumption types used attributively, as in "used up items".
 * {@link CONSUMPTION_TYPE_LABELS} names the option as the picker titles it and
 * carries a parenthetical that is redundant next to the raw value, so prose
 * that already shows ONE_WAY or TWO_WAY uses these instead.
 */
export const CONSUMPTION_TYPE_ADJECTIVES = Object.freeze({
  ONE_WAY: "used up",
  TWO_WAY: "returnable",
});

// Stock-status verdicts for the assets-index `Stock status` column. Derived
// per QUANTITY_TRACKED asset by `POOL_STOCK_STATUS_EXPR` in the webapp's
// modules/asset/query.server.ts, over the `STOCK_STATUSES` values in
// @shelf/quantity-control; INDIVIDUAL assets get no verdict and render blank.
//
// Deliberately NOT stock-shop words. Shelf serves two cohorts and one of them
// rents returnable equipment: "Out of stock" on a fully booked camera pool is
// both the wrong noun and the wrong instruction (buy more vs. wait for the
// return). NONE_FREE / LOW / ENOUGH read correctly for a consumable and for a
// pooled asset alike. NO_THRESHOLD has no label on purpose, the cell renders
// an em dash, because a badge there reads as a level, and "nobody set a floor"
// is the absence of an opinion, not a healthy one.
export const STOCK_STATUS_LABELS = Object.freeze({
  SHORT: "Short",
  NONE_FREE: "None free",
  LOW: "Running low",
  ENOUGH: "Enough",
});

/**
 * How the explicit check-in and check-out requirement is explained, on the
 * website's two settings cards and on the phone where the quick button is
 * hidden by it.
 *
 * The two directions carry the same sentences with only the verb changed, so a
 * reader who learned one card can read the other without re-reading it. The
 * exemption is stated in full on every surface: the workspace owner is never
 * restricted by either switch, and Base users hold no booking check-in or
 * check-out permission at all, so neither switch applies to them.
 *
 * `TITLE` names the card, `EXEMPTION` is the sentence every card shows below
 * its heading, `PHONE_HINT` is the one line the companion renders where the
 * one-tap button is hidden. Per-role switch text comes from
 * {@link explicitRequirementSwitchDescription}.
 */
export const EXPLICIT_REQUIREMENT_LABELS = Object.freeze({
  CHECKIN: Object.freeze({
    TITLE: "Check-in needs each item scanned or selected",
    EXEMPTION:
      "The workspace owner is never restricted. Base users cannot check in.",
    PHONE_HINT:
      "Your workspace requires each item to be scanned or selected to check in.",
  }),
  CHECKOUT: Object.freeze({
    TITLE: "Check-out needs each item scanned or selected",
    EXEMPTION:
      "The workspace owner is never restricted. Base users cannot check out.",
    PHONE_HINT:
      "Your workspace requires each item to be scanned or selected to check out.",
  }),
});

/**
 * The two switches the explicit requirement can be turned on with, named as
 * the settings cards show them. The ADMIN switch also covers Managers, whose
 * policy reads the same setting. OWNER and BASE are absent on purpose: see the
 * exemption sentence in {@link EXPLICIT_REQUIREMENT_LABELS}.
 */
export const EXPLICIT_REQUIREMENT_ROLE_LABELS = Object.freeze({
  ADMIN: "Admins and Managers",
  SELF_SERVICE: "Self Service users",
});

/**
 * Describes what one switch on an explicit-requirement card does for its role.
 *
 * @param {"CHECKIN"|"CHECKOUT"} direction - which card the switch sits on
 * @param {"ADMIN"|"SELF_SERVICE"} role - the role the switch covers
 * @returns {string} e.g. "Removes the one-click check-in for Admins and Managers. They check
 *   items in by scanning them or by selecting them from the list."
 */
export function explicitRequirementSwitchDescription(direction, role) {
  const roleLabel = EXPLICIT_REQUIREMENT_ROLE_LABELS[role];
  if (direction === "CHECKIN") {
    return `Removes the one-click check-in for ${roleLabel}. They check items in by scanning them or by selecting them from the list.`;
  }
  return `Removes the one-click check-out for ${roleLabel}. They check items out by scanning them or by selecting them from the list.`;
}

/**
 * The booking check-in / check-out methods an app may declare in a request
 * body, keyed by themselves so call sites read `BOOKING_METHOD.scanned`.
 *
 * `scanned` is an item that went through a scanner, `selected` an item ticked
 * in a list. `quick` (the one-click whole-booking action) is not among them:
 * the server knows which routes are the one-click actions and records that
 * itself, so a client cannot label a scan as quick or the other way round.
 *
 * Shared because the server validates the field against exactly this list and
 * the companion sends it: a value one side renames without the other would
 * refuse every check-in and check-out from the phone.
 */
export const BOOKING_METHOD = Object.freeze({
  scanned: "scanned",
  selected: "selected",
});

/** {@link BOOKING_METHOD} as a tuple, the shape a validation enum takes. */
export const CLIENT_DECLARED_BOOKING_METHODS = Object.freeze([
  BOOKING_METHOD.scanned,
  BOOKING_METHOD.selected,
]);

/**
 * Name of the form field that carries a typed delete confirmation. The bulk
 * delete endpoints read it, and every confirm dialog posts it under this name.
 */
export const DELETE_CONFIRMATION_FIELD = "confirmation";

/**
 * The word a delete asks for when the item has no name to type: a blank title,
 * or one made only of spaces or invisible characters.
 */
export const DELETE_CONFIRMATION_FALLBACK = "delete";

/**
 * The invisible format characters a delete confirmation ignores: soft hyphen,
 * Arabic letter mark, Mongolian vowel separator, zero-width space, joiners and
 * direction marks, bidi embeddings and isolates, word joiner and invisible
 * operators, byte order mark, and interlinear annotation marks.
 *
 * Spelled out rather than written as `\p{Cf}`: the companion bundles this
 * package for Hermes, and an explicit class compiles on every engine both apps
 * support.
 */
const INVISIBLE_FORMAT_CHARACTERS =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;

/**
 * Reduces a typed delete confirmation to the form it is compared in.
 *
 * Drops {@link INVISIBLE_FORMAT_CHARACTERS} (zero-width space, joiners, byte
 * order mark and the like) first: the instruction cannot show them, so they
 * are never asked for. Then Unicode NFC, after the drop so a letter and an
 * accent that sat on either side of an invisible character still compose: a
 * macOS keyboard can emit a decomposed "é" while the stored name holds the
 * composed one, and the two would never match. Then trims, collapses runs of
 * whitespace (a title with a double space must not demand one) and
 * lower-cases. The point of the field is a deliberate act, not a spelling
 * test.
 *
 * @param {unknown} value - what the user typed, or the expected name or count
 * @returns {string} the comparable form; "" for null or undefined
 */
export function normalizeDeleteConfirmation(value) {
  return String(value ?? "")
    .replace(INVISIBLE_FORMAT_CHARACTERS, "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * What the user must type to confirm a delete: the item's name or count, or
 * {@link DELETE_CONFIRMATION_FALLBACK} when the name is blank once normalized.
 * Every surface shows this in its instruction rather than the raw name, which
 * can be blank.
 *
 * @param {string | number} expected - the item's name, or the number of
 *   selected items for a bulk delete
 * @returns {string} the text to show and to type
 */
export function deleteConfirmationTarget(expected) {
  return normalizeDeleteConfirmation(expected)
    ? String(expected)
    : DELETE_CONFIRMATION_FALLBACK;
}

/**
 * Whether a typed confirmation unlocks a delete.
 *
 * One rule for every surface: the webapp dialogs, the server guards and the
 * companion's delete sheets all call this, so the button the user sees
 * enabled is never refused by the server for a spelling difference. The typed
 * value is compared with {@link deleteConfirmationTarget}, which is never
 * blank, so an empty input confirms nothing, a nameless item included.
 *
 * @param {unknown} typed - what the user typed
 * @param {string | number} expected - the item's name, or the number of
 *   selected items for a bulk delete
 * @returns {boolean} true when they match after normalization
 */
export function deleteConfirmationMatches(typed, expected) {
  return (
    normalizeDeleteConfirmation(typed) ===
    normalizeDeleteConfirmation(deleteConfirmationTarget(expected))
  );
}

/**
 * What a permanent delete removes, for the deletes both apps offer. The
 * webapp's delete dialogs and the companion's delete sheets show these, so a
 * user reads the same consequences on either device.
 */
export const DELETE_CONSEQUENCE_LABELS = Object.freeze({
  ASSET:
    "This permanently deletes the asset and everything recorded on it: notes, custody, reminders and custom field values. It is removed from every booking, kit and audit it was part of, past and upcoming, and its QR code is unlinked. This cannot be undone.",
  BOOKING:
    "This permanently deletes the booking with its notes, model reservations and check-in and check-out history. If it is ongoing or overdue, its assets become available. This cannot be undone.",
});
