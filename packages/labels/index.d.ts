/**
 * Type declarations for @shelf/labels (see index.js).
 * Hand-written to keep the package build-step-free.
 */
export declare const ASSET_STATUS_LABELS: {
  readonly AVAILABLE: "Available";
  readonly IN_CUSTODY: "In custody";
  readonly CHECKED_OUT: "Checked out";
};

export declare const ASSET_QTY_STATUS_LABELS: {
  readonly AVAILABLE: "Available";
  readonly IN_CUSTODY: "In custody";
  readonly PARTIAL_CUSTODY: "Partial custody";
  readonly CHECKED_OUT: "Checked out";
  readonly PARTIALLY_CHECKED_OUT: "Partially checked out";
  readonly RESERVED: "Reserved";
  readonly PARTIALLY_RESERVED: "Partially reserved";
};

export declare const ASSET_BOOKING_PSEUDO_STATUS_LABELS: {
  readonly ALREADY_CHECKED_IN: "Already checked in";
  readonly PARTIALLY_CHECKED_IN: "Partially checked in";
  readonly PARTIALLY_CHECKED_OUT: "Partially checked out";
};

export declare const BOOKING_STATUS_LABELS: {
  readonly DRAFT: "Draft";
  readonly RESERVED: "Reserved";
  readonly ONGOING: "Ongoing";
  readonly OVERDUE: "Overdue";
  readonly COMPLETE: "Complete";
  readonly ARCHIVED: "Archived";
  readonly CANCELLED: "Cancelled";
};

/**
 * Audit session lifecycle (AuditStatus in the Prisma schema). Covers ARCHIVED,
 * which a hand-written status chain on the companion used to fall through to
 * "Cancelled".
 */
export declare const AUDIT_STATUS_LABELS: {
  readonly PENDING: "Pending";
  readonly ACTIVE: "Active";
  readonly COMPLETED: "Completed";
  readonly CANCELLED: "Cancelled";
  readonly ARCHIVED: "Archived";
};

/**
 * Who may act on an audit with no specific assignee, in the three registers the
 * two apps need: `SHORT` for a card's meta line, `A11Y` for the lowercase
 * fragment joined into a screen-reader announcement, `DETAIL` for the web's
 * explanatory tooltip. Kept together so they can never disagree.
 */
export declare const AUDIT_UNASSIGNED_LABELS: {
  readonly SHORT: "Unassigned · admins can scan";
  readonly A11Y: "unassigned, admins can scan";
  readonly DETAIL: "Workspace admins and owners can perform this audit because it has no specific assignee.";
};

/**
 * Per-asset audit outcome (AuditAssetStatus in the Prisma schema).
 *
 * PENDING reads "Not scanned", not "Expected"/"Pending"/"Remaining": all of
 * those were live at once for one and the same set of assets, and "Expected"
 * was already taken by the tile counting EVERY expected asset. Prefer
 * {@link auditAssetStatusLabel} over indexing this map for PENDING, since only
 * that helper applies the completion rule.
 */
export declare const AUDIT_ASSET_STATUS_LABELS: {
  readonly PENDING: "Not scanned";
  readonly FOUND: "Found";
  readonly MISSING: "Missing";
  readonly UNEXPECTED: "Unexpected";
};

/** Enum keys of {@link AUDIT_ASSET_STATUS_LABELS} — the Prisma status values. */
export type AuditAssetStatusKey = keyof typeof AUDIT_ASSET_STATUS_LABELS;

/** The user-facing strings those keys resolve to. */
export type AuditAssetStatusLabel =
  (typeof AUDIT_ASSET_STATUS_LABELS)[AuditAssetStatusKey];

/**
 * The single derivation of the completion flag every audit label depends on.
 *
 * Reads `completedAt`, never `status`: archiving a completed audit rewrites the
 * status to ARCHIVED while keeping the timestamp and the finalised counts, so a
 * status check relabels genuinely missing assets as "Not scanned" on archive.
 * An archived-CANCELLED audit was never concluded and correctly stays open.
 *
 * Accepts a `Date` (Prisma/web) or an ISO string (the companion's JSON), so
 * both apps can pass their session object straight in.
 *
 * @param audit - anything carrying the audit's `completedAt`
 * @returns true once the audit has been concluded
 */
export declare function isAuditCompleted(
  audit: { completedAt?: Date | string | null } | null | undefined
): boolean;

/**
 * Label for a per-asset audit status. An expected asset that has not been
 * scanned only becomes "Missing" once the audit is completed.
 *
 * @param status - the stored AuditAssetStatus
 * @param isAuditCompleted - derive this with {@link isAuditCompleted}, never
 *   from the audit's status
 * @returns the words to show for that status
 */
export declare function auditAssetStatusLabel(
  status: AuditAssetStatusKey,
  isAuditCompleted: boolean
): AuditAssetStatusLabel;
