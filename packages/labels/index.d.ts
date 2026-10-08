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

/**
 * How a kit's state is named, on the website and on the phone.
 *
 * `AVAILABLE`, `IN_CUSTODY` and `CHECKED_OUT` are the persisted `KitStatus`
 * enum; `PARTIALLY_CHECKED_IN` is derived by a booking for a kit whose every
 * member it holds has been checked back in while the booking still runs.
 *
 * The three enum entries carry the same wording as {@link ASSET_STATUS_LABELS}
 * without being spread from it — a booking shows a kit and the assets inside it
 * on one screen, so the strings must agree, while the key set must keep
 * tracking `KitStatus` alone.
 */
export declare const KIT_STATUS_LABELS: {
  readonly AVAILABLE: "Available";
  readonly IN_CUSTODY: "In custody";
  readonly CHECKED_OUT: "Checked out";
  readonly PARTIALLY_CHECKED_IN: "Already checked in";
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

/** Audit session lifecycle (AuditStatus in the Prisma schema). */
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
  readonly SHORT: "Unassigned · admins and owners can scan";
  readonly A11Y: "unassigned, admins and owners can scan";
  readonly DETAIL: "Workspace admins and owners can perform this audit because it has no specific assignee.";
};

/**
 * Per-asset audit outcome (AuditAssetStatus in the Prisma schema).
 *
 * PENDING reads "Not scanned" rather than "Expected", which is the name of the
 * tile counting EVERY asset the audit covers. Prefer
 * {@link auditAssetStatusLabel} over indexing this map for PENDING, since only
 * that helper applies the completion rule.
 */
export declare const AUDIT_ASSET_STATUS_LABELS: {
  readonly PENDING: "Not scanned";
  readonly FOUND: "Found";
  readonly MISSING: "Missing";
  readonly UNEXPECTED: "Unexpected";
};

/**
 * Wording for an audit scan whose asset no longer exists.
 *
 * Deleting an asset leaves the scan row behind with nothing to name it but the
 * title captured at scan time, so both apps must say it the same way. Prefer
 * {@link auditDeletedAssetLabel} over indexing this map — only that helper
 * applies the "keep the snapshotted title" rule.
 */
export declare const AUDIT_DELETED_ASSET_LABELS: {
  readonly UNTITLED: "Deleted asset";
};

/**
 * Names a scan whose asset has been deleted, keeping the title it had when it
 * was scanned and marking it as gone.
 *
 * @param title - the snapshotted title, if any
 * @returns the row's display name
 */
export declare function auditDeletedAssetLabel(
  title: string | null | undefined
): string;

/** Enum keys of {@link AUDIT_ASSET_STATUS_LABELS} — the Prisma status values. */
export type AuditAssetStatusKey = keyof typeof AUDIT_ASSET_STATUS_LABELS;

/** Enum keys of {@link AUDIT_STATUS_LABELS} — the Prisma AuditStatus values. */
export type AuditStatusKey = keyof typeof AUDIT_STATUS_LABELS;

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

/**
 * Why a booking cannot be reserved yet — the three rules web's Reserve button
 * disables on, in one register for every surface that states them (web
 * tooltip, mobile route 400, in-transaction guard, companion client note).
 *
 * These are the *reasons the button is blocked*. They are not the outcome of a
 * failed write: `reserveBooking`'s race-safe conflict check names the specific
 * offending assets and keeps its own richer message.
 */
export declare const BOOKING_RESERVE_BLOCKED_LABELS: {
  readonly NOTHING_TO_RESERVE: "Add assets or reserve at least one model on this booking before you reserve it.";
  readonly UNAVAILABLE_ASSETS: "This booking holds assets marked as unavailable. Remove them, or make them available again, before reserving.";
  readonly ALREADY_BOOKED: "This booking holds assets already booked for that period. Remove them, or change the dates, before reserving.";
};

/**
 * Refusal shown when emptying a RESERVED booking — the same zero-asset
 * invariant the Reserve guards defend, enforced on the removal side so it
 * cannot be reached from the other direction.
 *
 * RESERVED only: an empty DRAFT is normal work-in-progress, the terminal
 * statuses hold nothing, and ONGOING / OVERDUE bookings must stay emptiable so
 * a checked-out asset can still be pulled off a live booking.
 */
export declare const BOOKING_EMPTY_RESERVED_MESSAGE: "A reserved booking must keep at least one asset or model reservation. Cancel the booking instead, or add a replacement first.";

/**
 * Title of the refusal and disabled reasons for custody of an individually
 * tracked kit member. Custody of such an asset comes from its kit. Shared by
 * the server's 400, the web menus and the companion asset screen.
 */
export declare const KIT_MEMBER_CUSTODY_BLOCKED_TITLE: "Asset is part of a kit";

/**
 * The reason a single kit member's "Assign custody" action is disabled.
 *
 * @param kitName - the name of the kit the asset belongs to
 */
export declare function kitMemberCustodyBlockedReason(kitName: string): string;

/**
 * The server's refusal when an assign request names a kit member.
 *
 * @param names - the asset's title and its kit's name
 */
export declare function kitMemberCustodyRefusal(names: {
  assetTitle: string;
  kitName: string;
}): string;

/**
 * The server's refusal when an assign request names several kit members: the
 * count plus the first few titles. One member reads exactly as
 * {@link kitMemberCustodyRefusal}.
 *
 * @param members - at least one kit member, with its title and kit's name
 */
export declare function kitMembersCustodyRefusal(
  members: { assetTitle: string; kitName: string }[]
): string;

/**
 * The reason a bulk "Assign custody" action is disabled when the selection
 * holds at least one kit member.
 */
export declare const KIT_MEMBERS_CUSTODY_BLOCKED_REASON: "Some of the selected assets are part of a kit. Assign custody to the kit, or remove them from the kit first.";

/**
 * The semantic weight a status badge carries, independent of any palette. Each
 * app maps a tone onto its own colours (the webapp's fixed hex `BADGE_COLORS`,
 * the companion's light/dark theme), so the VALUES stay app-owned while the
 * DECISION is shared.
 *
 * neutral → grey · info → blue · success → green · warning → amber · danger → red
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Tone for each audit session status. */
export declare const AUDIT_STATUS_TONES: Readonly<
  Record<AuditStatusKey, StatusTone>
>;

/** Tone for each per-asset audit outcome, escalating neutral → danger. */
export declare const AUDIT_ASSET_STATUS_TONES: Readonly<
  Record<AuditAssetStatusKey, StatusTone>
>;

export declare const ASSET_TYPE_LABELS: {
  readonly INDIVIDUAL: "Individually tracked";
  readonly QUANTITY_TRACKED: "Tracked by quantity";
};

export declare const CONSUMPTION_TYPE_LABELS: {
  readonly ONE_WAY: "Used up (one-way)";
  readonly TWO_WAY: "Returnable (two-way)";
};

export declare const CONSUMPTION_TYPE_DESCRIPTIONS: {
  readonly ONE_WAY: "consumed and not returned";
  readonly TWO_WAY: "checked out and returned";
};

export declare const ASSET_TYPE_ADJECTIVES: {
  readonly INDIVIDUAL: "individually tracked";
  readonly QUANTITY_TRACKED: "quantity-tracked";
};

export declare const CONSUMPTION_TYPE_ADJECTIVES: {
  readonly ONE_WAY: "used up";
  readonly TWO_WAY: "returnable";
};

/**
 * How the explicit check-in and check-out requirement is explained on the
 * website's settings cards and on the phone. The two directions carry the same
 * sentences with only the verb changed. `TITLE` names the card, `EXEMPTION` is
 * the always-visible sentence under its heading (the owner is never restricted,
 * Base users hold no check-in or check-out permission), `PHONE_HINT` is the one
 * line the companion renders where the one-tap button is hidden.
 */
export declare const EXPLICIT_REQUIREMENT_LABELS: {
  readonly CHECKIN: {
    readonly TITLE: "Check-in needs each item scanned or selected";
    readonly EXEMPTION: "The workspace owner is never restricted. Base users cannot check in.";
    readonly PHONE_HINT: "Your workspace requires each item to be scanned or selected to check in.";
  };
  readonly CHECKOUT: {
    readonly TITLE: "Check-out needs each item scanned or selected";
    readonly EXEMPTION: "The workspace owner is never restricted. Base users cannot check out.";
    readonly PHONE_HINT: "Your workspace requires each item to be scanned or selected to check out.";
  };
};

/** The card the explicit requirement is being described for. */
export type ExplicitRequirementDirection =
  keyof typeof EXPLICIT_REQUIREMENT_LABELS;

/** The two roles a switch can cover, named as the settings cards show them. */
export declare const EXPLICIT_REQUIREMENT_ROLE_LABELS: {
  readonly ADMIN: "Admins and Managers";
  readonly SELF_SERVICE: "Self Service users";
};

/** A role an explicit-requirement switch can cover. */
export type ExplicitRequirementRole =
  keyof typeof EXPLICIT_REQUIREMENT_ROLE_LABELS;

/**
 * Describes what one switch on an explicit-requirement card does for its role,
 * e.g. "Removes the one-click check-in for Admins and Managers. They check items in by
 * scanning them or by selecting them from the list."
 *
 * @param direction - which card the switch sits on
 * @param role - the role the switch covers
 */
export declare function explicitRequirementSwitchDescription(
  direction: ExplicitRequirementDirection,
  role: ExplicitRequirementRole
): string;

/**
 * The booking check-in / check-out methods an app may declare in a request
 * body. `quick` is server-only: the server records it for the one-click routes.
 */
export declare const BOOKING_METHOD: {
  readonly scanned: "scanned";
  readonly selected: "selected";
};

/** {@link BOOKING_METHOD} as a tuple, the shape a validation enum takes. */
export declare const CLIENT_DECLARED_BOOKING_METHODS: readonly [
  "scanned",
  "selected",
];

/** A method an app may declare on a check-in or check-out request. */
export type ClientDeclaredBookingMethod =
  (typeof CLIENT_DECLARED_BOOKING_METHODS)[number];
