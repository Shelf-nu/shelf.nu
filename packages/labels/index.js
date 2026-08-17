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
 * different word than the website (the 1.1.x "In custody" vs "Partial custody"
 * drift class).
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
// three can never say different things about who is allowed to scan; before
// this, the sentence was hand-copied to six call sites across both apps.
export const AUDIT_UNASSIGNED_LABELS = Object.freeze({
  SHORT: "Unassigned · admins can scan",
  A11Y: "unassigned, admins can scan",
  DETAIL:
    "Workspace admins and owners can perform this audit because it has no specific assignee.",
});

// Per-asset audit status (AuditAssetStatus in the Prisma schema).
//
// PENDING is deliberately "Not scanned", not "Expected"/"Pending"/"Remaining":
// all three were in use at once (web rows said "Expected", the web statistics
// tile said "Missing", mobile said "Pending", the mobile scanner said
// "Remaining") for one and the same set of assets. "Expected" was already
// taken by the tile that counts EVERY expected asset, so the not-yet-scanned
// subset needs a word of its own.
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
