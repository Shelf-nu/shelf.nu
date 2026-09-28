/**
 * `@shelf/permissions`, how far a membership reaches.
 *
 * `resolveRoleAccess` folds a membership's policy with the workspace's
 * visibility toggles into one `RoleAccess` object. Servers compute it once per
 * request; clients receive the same object from the layout loader, so the UI
 * and the server read one answer.
 */
import type { BookingStatusName, RolePolicy } from "./policies";
import { ROLE_POLICIES, ROLES_BY_RANK } from "./policies";
import { resolveRole } from "./resolve-role";
import type { OrganizationRole } from "./roles";
import { ROLE_LABELS } from "./roles";

/** The workspace toggles that widen restricted roles' own-scopes. */
export type WorkspaceAccessSettings = {
  selfServiceCanSeeBookings: boolean;
  baseUserCanSeeBookings: boolean;
  selfServiceCanSeeCustody: boolean;
  baseUserCanSeeCustody: boolean;
};

/** A membership's resolved reach. */
export type RoleAccess = {
  /** The effective (highest-rank) role. */
  role: OrganizationRole;
  /** That role's policy, for fields used as-is. */
  policy: RolePolicy;
  bookings: { seeAll: boolean; writeAll: boolean };
  custody: { seeAll: boolean; assign: RolePolicy["custody"]["assign"] };
  audits: { seeAll: boolean };
  /** OWNER is anywhere in the membership. */
  ownsWorkspace: boolean;
};

/** The workspace's explicit check-out / check-in switches. */
export type ExplicitScanSettings = {
  requireExplicitCheckoutForAdmin: boolean;
  requireExplicitCheckoutForSelfService: boolean;
  requireExplicitCheckinForAdmin: boolean;
  requireExplicitCheckinForSelfService: boolean;
};

const CLOSED: readonly BookingStatusName[] = [
  "COMPLETE",
  "ARCHIVED",
  "CANCELLED",
];

/**
 * Whether the workspace toggle a role's policy names is switched on.
 *
 * @param policy - The role's policy
 * @param workspace - The workspace toggles
 * @param kind - Which pair: bookings or custody
 */
function toggleOn(
  policy: RolePolicy,
  workspace: WorkspaceAccessSettings,
  kind: "Bookings" | "Custody"
): boolean {
  if (policy.workspaceOverride === "selfService") {
    return workspace[`selfServiceCanSee${kind}`];
  }
  if (policy.workspaceOverride === "baseUser") {
    return workspace[`baseUserCanSee${kind}`];
  }
  return false;
}

/**
 * Whether OWNER is anywhere in a membership, the one sanctioned owner check.
 *
 * @param roles - Every role on the membership
 */
export function isWorkspaceOwner(
  roles: readonly string[] | undefined
): boolean {
  return (roles ?? []).includes("OWNER");
}

/**
 * Resolves a membership's reach.
 *
 * @param args.roles - Every role on the membership (unknown/empty -> BASE)
 * @param args.workspace - The workspace's visibility toggles
 * @returns The resolved access
 */
export function resolveRoleAccess({
  roles,
  workspace,
}: {
  roles: readonly string[] | undefined;
  workspace: WorkspaceAccessSettings;
}): RoleAccess {
  const role = resolveRole(roles);
  const policy = ROLE_POLICIES[role];
  return {
    role,
    policy,
    bookings: {
      seeAll:
        policy.bookings.see === "all" ||
        toggleOn(policy, workspace, "Bookings"),
      writeAll: policy.bookings.write === "all",
    },
    custody: {
      seeAll:
        policy.custody.see === "all" || toggleOn(policy, workspace, "Custody"),
      assign: policy.custody.assign,
    },
    audits: { seeAll: policy.audits.scope === "all" },
    ownsWorkspace: isWorkspaceOwner(roles),
  };
}

/**
 * Roles whose policy satisfies a predicate, most privileged first. Use it to
 * build Prisma role filters (`roles: { hasSome: rolesWhere(...) }`) instead of
 * listing roles by hand.
 *
 * @param predicate - A question about a policy
 */
export function rolesWhere(
  predicate: (policy: RolePolicy) => boolean
): OrganizationRole[] {
  return ROLES_BY_RANK.filter((r) => predicate(ROLE_POLICIES[r]));
}

/**
 * Whether items may be ADDED to a booking in this status.
 *
 * @param args.access - The caller's access
 * @param args.bookingStatus - The booking's status
 */
export function canManageBookingItems({
  access,
  bookingStatus,
}: {
  access: RoleAccess;
  bookingStatus: BookingStatusName;
}): boolean {
  if (CLOSED.includes(bookingStatus)) return false;
  return (
    access.policy.bookings.manageItemsAfterDraft || bookingStatus === "DRAFT"
  );
}

/**
 * Whether items may be REMOVED from a booking in this status.
 *
 * @param args.access - The caller's access
 * @param args.bookingStatus - The booking's status
 */
export function canRemoveBookingItems({
  access,
  bookingStatus,
}: {
  access: RoleAccess;
  bookingStatus: BookingStatusName;
}): boolean {
  return access.policy.bookings.removableItemStatuses.includes(bookingStatus);
}

/**
 * The partial-scan pages' rule (web check-out/check-in pages, mobile partial
 * check-in): the manage-items rule, or, for roles with `partialScanAsCustodian`,
 * a live booking the caller is the custodian of. Only the partial check-out
 * and check-in pages (web loader and action) and the mobile partial check-in
 * endpoint call this; the quick, overview and fulfil paths keep their own
 * guard instead.
 *
 * @param args.direction - checkout accepts RESERVED/ONGOING/OVERDUE, checkin ONGOING/OVERDUE
 */
export function canPartialCheckInOut({
  access,
  booking,
  userId,
  direction,
}: {
  access: RoleAccess;
  booking: { status: BookingStatusName; custodianUserId: string | null };
  userId: string;
  direction: "checkout" | "checkin";
}): boolean {
  const live: readonly BookingStatusName[] =
    direction === "checkout"
      ? ["RESERVED", "ONGOING", "OVERDUE"]
      : ["ONGOING", "OVERDUE"];
  if (
    access.policy.bookings.partialScanAsCustodian &&
    live.includes(booking.status) &&
    booking.custodianUserId === userId
  ) {
    return true;
  }
  return canManageBookingItems({ access, bookingStatus: booking.status });
}

/**
 * Whether the workspace requires the explicit (scan or select) flow for this caller.
 *
 * @param args.direction - which pair of switches to read
 */
export function isExplicitScanRequired({
  access,
  settings,
  direction,
}: {
  access: RoleAccess;
  settings: ExplicitScanSettings;
  direction: "checkout" | "checkin";
}): boolean {
  const which = access.policy.bookings.explicitScanSetting;
  if (which === "none") return false;
  const dir = direction === "checkout" ? "Checkout" : "Checkin";
  const who = which === "admin" ? "Admin" : "SelfService";
  return settings[`requireExplicit${dir}For${who}`];
}

/**
 * Whether changing a member's role moves their ownership columns
 * (assets, categories, tags, ...) to someone else.
 */
export function transfersOwnershipOnRoleChange({
  from,
  to,
}: {
  from: OrganizationRole;
  to: OrganizationRole;
}): boolean {
  return (
    ROLE_POLICIES[to].membership.ownershipTier <
    ROLE_POLICIES[from].membership.ownershipTier
  );
}

/**
 * Whether changing a member's role moves the bookings they created for other
 * registered custodians to someone else.
 */
export function transfersBookingsOnRoleChange({
  from,
  to,
}: {
  from: OrganizationRole;
  to: OrganizationRole;
}): boolean {
  return (
    ROLE_POLICIES[from].bookings.write === "all" &&
    ROLE_POLICIES[to].bookings.write === "own"
  );
}

/**
 * The role a human label names, for forms and CSV imports that submit labels.
 *
 * @param label - e.g. "Self service"
 * @returns The role, or `undefined` for an unknown label
 */
export function labelToRole(label: string): OrganizationRole | undefined {
  return (Object.keys(ROLE_LABELS) as OrganizationRole[]).find(
    (r) => ROLE_LABELS[r] === label
  );
}
