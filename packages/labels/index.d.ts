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
 * Label for a per-asset audit status. An expected asset that has not been
 * scanned only becomes "Missing" once the audit is completed.
 *
 * @param status - the stored AuditAssetStatus
 * @param isAuditCompleted - derive this from the audit's `completedAt`, not its
 *   status: archiving a completed audit rewrites the status to ARCHIVED while
 *   keeping the completion timestamp and the finalised counts.
 * @returns the words to show for that status
 */
export declare function auditAssetStatusLabel(
  status: AuditAssetStatusKey,
  isAuditCompleted: boolean
): AuditAssetStatusLabel;
