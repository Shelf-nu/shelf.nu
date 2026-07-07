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
