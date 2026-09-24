/**
 * `@shelf/permissions`, the role policy table.
 *
 * The permission matrix answers "may this role do action X on entity Y?".
 * This table answers the other kind of question: how far a role reaches,
 * whose bookings, whose custody, which audits, which limits apply, who hears
 * about what. Every role has an explicit row; there is no short-circuit, and
 * the record is total, so adding a role without a row does not compile.
 *
 * Read it through `resolveRoleAccess` (./access) rather than directly: several
 * answers also depend on workspace settings.
 */
import type { OrganizationRole } from "./roles";
import { ORGANIZATION_ROLES } from "./roles";

/** Booking status names, value-identical to Prisma's `BookingStatus`. */
export const BOOKING_STATUS_NAMES = [
  "DRAFT",
  "RESERVED",
  "ONGOING",
  "OVERDUE",
  "COMPLETE",
  "ARCHIVED",
  "CANCELLED",
] as const;

/** A single booking status name. */
export type BookingStatusName = (typeof BOOKING_STATUS_NAMES)[number];

/**
 * The fields of a role policy. Use `RolePolicy` (below), which adds the rule
 * tying `workspaceOverride` to the visibility scopes.
 */
type RolePolicyShape = {
  /** Precedence for multi-role memberships: highest wins in `resolveRole`. Unique. */
  rank: number;
  /**
   * Which workspace visibility toggle pair widens this role's own-scopes
   * (`selfServiceCanSee*` or `baseUserCanSee*`); `null` when scopes are already "all".
   */
  workspaceOverride: "selfService" | "baseUser" | null;
  bookings: {
    /** Which bookings the role may see. */
    see: "all" | "own-unless-workspace-allows";
    /** Which bookings the role may write to (edit, check out/in, extend, cancel, archive, delete, items). */
    write: "all" | "own";
    /** Statuses in which the role may remove items (closed statuses are never listed). */
    removableItemStatuses: readonly BookingStatusName[];
    /** May add items to a booking that is past DRAFT. */
    manageItemsAfterDraft: boolean;
    /** May add items through the booking scan page once past DRAFT (the scan page's own rule). */
    scanAddAfterDraft: boolean;
    /** On the partial-scan pages, may act on a live booking it is the custodian of. */
    partialScanAsCustodian: boolean;
    /** Booking buffer and maximum length limits are skipped. */
    bypassTimeLimits: boolean;
    /** Which workspace explicit check-out/in switch applies; "none" = exempt or not covered. */
    explicitScanSetting: "admin" | "selfService" | "none";
    /** Delete is limited to DRAFT bookings. */
    deleteOnlyDrafts: boolean;
    /** The booking custodian picker is fixed to the user themself. */
    custodianPicker: "anyone" | "self";
    /** The bookings-index bulk-actions menu is shown. */
    showBulkActions: boolean;
    /** May download the PDF / .ics of a booking the user is not the custodian of. */
    documentsForOthers: boolean;
  };
  assets: {
    /** The asset list shows every asset, or only those available to book. */
    listScope: "all" | "bookable";
  };
  custody: {
    /** Whose custody the role may see. */
    see: "all" | "own-unless-workspace-allows";
    /** To whom the role may assign custody, and whose custody it may release. */
    assign: "anyone" | "self" | "none";
  };
  audits: {
    /** Which audits the role may see and act in (actions still need the matrix grant). */
    scope: "all" | "assigned";
    /** May edit, cancel or change audits created by someone else. */
    manageOthers: boolean;
  };
  notifications: {
    /** Receives org-wide booking broadcasts (e.g. new reservation "pickup" alerts). */
    orgBookingBroadcasts: boolean;
    /** A reservation made BY this role triggers the org booking broadcast. */
    reservationAlertsAdmins: boolean;
    /** May view and edit a booking's extra notification recipients. */
    manageBookingRecipients: boolean;
    /** Receives low-stock inventory alerts. */
    inventoryAlerts: boolean;
    /** May be picked as an extra booking-notification or reminder recipient. */
    selectableAsRecipient: boolean;
  };
  ui: {
    /** Where `/` sends the user. */
    landing: "/assets" | "/bookings";
    /** Asset index mode before the user saves a preference. */
    defaultAssetIndexMode: "SIMPLE" | "ADVANCED";
    /** The advanced asset index is available. */
    advancedAssetIndex: boolean;
  };
  membership: {
    /** Ownership tier: moving to a LOWER tier transfers ownership columns. Equal tiers never do. */
    ownershipTier: number;
    /** Granting, changing or revoking this role requires the workspace owner. */
    changeRequiresOwner: boolean;
    /** May receive entities transferred on another member's removal or demotion. */
    canReceiveTransfers: boolean;
    /** May be chosen as the new owner in an ownership transfer. */
    eligibleAsNewOwner: boolean;
    /** Can be chosen when inviting or changing a user's role. */
    invitable: boolean;
    /** Can be conferred by an SSO group mapping. */
    ssoAssignable: boolean;
    /** Genuinely owns the workspace (billing, add-ons, ownership transfer). */
    ownsWorkspace: boolean;
  };
};

/**
 * Everything a role may reach beyond the permission matrix.
 *
 * A discriminated union on `workspaceOverride`: a role that names no workspace
 * toggle must see ALL bookings and ALL custody. An "own-unless-workspace-allows"
 * scope with `workspaceOverride: null` is a type error, because such a row would
 * compile and then silently ignore the workspace toggles.
 */
export type RolePolicy =
  | (Omit<RolePolicyShape, "workspaceOverride" | "bookings" | "custody"> & {
      workspaceOverride: null;
      bookings: RolePolicyShape["bookings"] & { see: "all" };
      custody: RolePolicyShape["custody"] & { see: "all" };
    })
  | (RolePolicyShape & { workspaceOverride: "selfService" | "baseUser" });

const OPEN_STATUSES = ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"] as const;

/** The policy for every organization role. Total: a missing role is a compile error. */
export const ROLE_POLICIES: Record<OrganizationRole, RolePolicy> = {
  OWNER: {
    rank: 5,
    workspaceOverride: null,
    bookings: {
      see: "all",
      write: "all",
      removableItemStatuses: OPEN_STATUSES,
      manageItemsAfterDraft: true,
      scanAddAfterDraft: true,
      partialScanAsCustodian: false,
      bypassTimeLimits: true,
      explicitScanSetting: "none",
      deleteOnlyDrafts: false,
      custodianPicker: "anyone",
      showBulkActions: true,
      documentsForOthers: true,
    },
    assets: { listScope: "all" },
    custody: { see: "all", assign: "anyone" },
    audits: { scope: "all", manageOthers: true },
    notifications: {
      orgBookingBroadcasts: true,
      reservationAlertsAdmins: false,
      manageBookingRecipients: true,
      inventoryAlerts: true,
      selectableAsRecipient: true,
    },
    ui: {
      landing: "/assets",
      defaultAssetIndexMode: "ADVANCED",
      advancedAssetIndex: true,
    },
    membership: {
      ownershipTier: 3,
      changeRequiresOwner: true,
      canReceiveTransfers: true,
      eligibleAsNewOwner: false,
      invitable: false,
      ssoAssignable: false,
      ownsWorkspace: true,
    },
  },
  ADMIN: {
    rank: 4,
    workspaceOverride: null,
    bookings: {
      see: "all",
      write: "all",
      removableItemStatuses: OPEN_STATUSES,
      manageItemsAfterDraft: true,
      scanAddAfterDraft: true,
      partialScanAsCustodian: false,
      bypassTimeLimits: true,
      explicitScanSetting: "admin",
      deleteOnlyDrafts: false,
      custodianPicker: "anyone",
      showBulkActions: true,
      documentsForOthers: true,
    },
    assets: { listScope: "all" },
    custody: { see: "all", assign: "anyone" },
    audits: { scope: "all", manageOthers: true },
    notifications: {
      orgBookingBroadcasts: true,
      reservationAlertsAdmins: false,
      manageBookingRecipients: true,
      inventoryAlerts: true,
      selectableAsRecipient: true,
    },
    ui: {
      landing: "/assets",
      defaultAssetIndexMode: "ADVANCED",
      advancedAssetIndex: true,
    },
    membership: {
      ownershipTier: 2,
      changeRequiresOwner: true,
      canReceiveTransfers: true,
      eligibleAsNewOwner: true,
      invitable: true,
      ssoAssignable: true,
      ownsWorkspace: false,
    },
  },
  SELF_SERVICE: {
    rank: 2,
    workspaceOverride: "selfService",
    bookings: {
      see: "own-unless-workspace-allows",
      write: "own",
      removableItemStatuses: ["DRAFT", "RESERVED"],
      manageItemsAfterDraft: false,
      scanAddAfterDraft: false,
      partialScanAsCustodian: true,
      bypassTimeLimits: false,
      explicitScanSetting: "selfService",
      // Flipped to `true` by fix F5 in Task 4.
      deleteOnlyDrafts: false,
      custodianPicker: "self",
      showBulkActions: false,
      documentsForOthers: false,
    },
    assets: { listScope: "bookable" },
    custody: { see: "own-unless-workspace-allows", assign: "self" },
    audits: { scope: "assigned", manageOthers: false },
    notifications: {
      orgBookingBroadcasts: false,
      reservationAlertsAdmins: true,
      manageBookingRecipients: false,
      inventoryAlerts: false,
      selectableAsRecipient: false,
    },
    ui: {
      landing: "/assets",
      defaultAssetIndexMode: "SIMPLE",
      advancedAssetIndex: false,
    },
    membership: {
      ownershipTier: 1,
      changeRequiresOwner: false,
      canReceiveTransfers: false,
      eligibleAsNewOwner: false,
      invitable: true,
      ssoAssignable: true,
      ownsWorkspace: false,
    },
  },
  BASE: {
    rank: 1,
    workspaceOverride: "baseUser",
    bookings: {
      see: "own-unless-workspace-allows",
      write: "own",
      removableItemStatuses: ["DRAFT"],
      manageItemsAfterDraft: false,
      scanAddAfterDraft: true,
      partialScanAsCustodian: false,
      bypassTimeLimits: false,
      explicitScanSetting: "none",
      deleteOnlyDrafts: true,
      custodianPicker: "self",
      showBulkActions: false,
      documentsForOthers: false,
    },
    assets: { listScope: "all" },
    custody: { see: "own-unless-workspace-allows", assign: "none" },
    audits: { scope: "assigned", manageOthers: false },
    notifications: {
      orgBookingBroadcasts: false,
      reservationAlertsAdmins: true,
      manageBookingRecipients: false,
      inventoryAlerts: false,
      selectableAsRecipient: false,
    },
    ui: {
      landing: "/assets",
      defaultAssetIndexMode: "SIMPLE",
      advancedAssetIndex: false,
    },
    membership: {
      ownershipTier: 1,
      changeRequiresOwner: false,
      canReceiveTransfers: false,
      eligibleAsNewOwner: false,
      invitable: true,
      ssoAssignable: true,
      ownsWorkspace: false,
    },
  },
};

/** Every role, most privileged first. */
export const ROLES_BY_RANK: readonly OrganizationRole[] = [
  ...ORGANIZATION_ROLES,
].sort((a, b) => ROLE_POLICIES[b].rank - ROLE_POLICIES[a].rank);

/** Roles that can be chosen when inviting or changing a user's role, most privileged first. */
export const INVITABLE_ROLES = ROLES_BY_RANK.filter(
  (r) => ROLE_POLICIES[r].membership.invitable
);

/** Roles an SSO group mapping can confer, most privileged first. */
export const SSO_ASSIGNABLE_ROLES = ROLES_BY_RANK.filter(
  (r) => ROLE_POLICIES[r].membership.ssoAssignable
);
