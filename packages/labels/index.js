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
