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

// Booking-context pseudo-statuses an asset row can show inside a booking
// (web canonical: the enum path in asset-status-badge/status-labels.ts).
export const ASSET_BOOKING_PSEUDO_STATUS_LABELS = Object.freeze({
  ALREADY_CHECKED_IN: "Already checked in",
  PARTIALLY_CHECKED_IN: "Partially checked in",
  PARTIALLY_CHECKED_OUT: "Partially checked out",
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
// All three name BOTH roles because the server allows both: requireAuditAssignee
// returns early for any caller that is not BASE/SELF_SERVICE, so ADMIN and OWNER
// are exactly the set who may scan an unassigned audit.
// Pinned by the AUDIT_UNASSIGNED_LABELS tests in the webapp.
export const AUDIT_UNASSIGNED_LABELS = Object.freeze({
  SHORT: "Unassigned · admins and owners can scan",
  A11Y: "unassigned, admins and owners can scan",
  DETAIL:
    "Workspace admins and owners can perform this audit because it has no specific assignee.",
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

// Why a booking cannot be reserved yet — the three rules web's Reserve button
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
