import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { ShelfError } from "./error";
import { ROLE_PRECEDENCE } from "./role-precedence";

/**
 * The minimal booking projection needed to decide whether a requester is the
 * booking's custodian. Both custody links must be selected by the caller:
 *
 * - `custodianUserId` — the direct user link.
 * - `custodianTeamMember.userId` — the user behind the team-member link.
 *
 * `custodianTeamMember` is optional so callers whose query genuinely cannot
 * reach the relation still typecheck, but omitting it silently narrows the
 * check back to the user link alone. Select it.
 */
export type BookingCustodyLinks = {
  custodianUserId: string | null;
  custodianTeamMember?: { userId: string | null } | null;
};

/**
 * Decides whether a requester may see a specific booking.
 *
 * A booking records custody on EITHER of two links, and a booking may carry
 * only the team-member one: rows assigned to a team member before a user was
 * attached to it keep `custodianUserId = NULL` even after the invite is
 * accepted and the two are linked. Matching on the user link alone therefore
 * fails closed for the very users those bookings belong to.
 *
 * This is the read-side mirror of the restriction {@link getBookings} applies
 * to the index (`custodianUserId = me OR custodianTeamMemberId IN my team
 * member ids`) and of the one `exportBookingsToCsv` applies to the export.
 * Keeping the three in agreement is the point of this helper: when the index
 * lists a row that the detail gate then refuses, the user sees a booking that
 * 403s on click.
 *
 * This does not widen access beyond the index — it grants only where the
 * booking's custodian team-member row IS the requester.
 *
 * @param params.canSeeAllBookings - Whether the role may see every booking in
 *   the workspace (ADMIN/OWNER, or SELF_SERVICE/BASE with the override).
 * @param params.booking - The booking's two custody links.
 * @param params.userId - The requester.
 * @returns `true` if the requester may see this booking.
 */
export function canSeeBooking({
  canSeeAllBookings,
  booking,
  userId,
}: {
  canSeeAllBookings: boolean;
  booking: BookingCustodyLinks;
  userId: string;
}): boolean {
  if (canSeeAllBookings) {
    return true;
  }

  return (
    booking.custodianUserId === userId ||
    booking.custodianTeamMember?.userId === userId
  );
}

/**
 * The query-side mirror of {@link validateBookingOwnership}'s default check:
 * the set of bookings a caller may MUTATE (add assets/kits to, edit, …).
 *
 * `validateBookingOwnership` is a per-row gate that runs at submit time. A
 * picker whose whole purpose is to choose a mutation target has to offer that
 * SAME set, or the user selects a row the action then 403s on. Sharing the
 * predicate is what keeps the two from drifting: change the rule below and the
 * gate, and every picker follows.
 *
 * Deliberately independent of `canSeeAllBookings`. That workspace toggle
 * governs READ visibility only — `validateBookingOwnership` ignores it, so a
 * SELF_SERVICE user in a workspace with the toggle on can view another user's
 * booking but still cannot write to it. Gating a mutation-target picker on the
 * read rule is what produced the dead-end this mirrors away.
 *
 * KNOWN GAP, intentionally mirrored rather than fixed here: like
 * `validateBookingOwnership`, this matches only `custodianUserId` and NOT the
 * team-member custody link, so a legacy booking whose custody sits solely on
 * `custodianTeamMemberId` is excluded. That is a faithful reflection of what
 * the action accepts today — offering those rows would just restore the 403.
 * Widening both together (as {@link canSeeBooking} already does for reads) is a
 * separate change that has to sweep every `validateBookingOwnership` call site.
 *
 * @param params.userId - The caller.
 * @param params.role - The caller's effective role in the workspace.
 * @returns A `Prisma.BookingWhereInput` to AND into the query, or `undefined`
 *   for ADMIN / OWNER, who may write to every booking in the workspace.
 */
export function bookingWriteScopeClause({
  userId,
  role,
}: {
  userId: string;
  role: OrganizationRoles;
}): Prisma.BookingWhereInput | undefined {
  // ALLOW-list, not a deny-list on SELF_SERVICE/BASE. A role added to the enum
  // later defaults to RESTRICTED here, so the picker under-offers (a visible
  // gap) rather than offering rows nobody checked. The gate below still
  // deny-lists, matching what it has always enforced — so for a hypothetical
  // new role this clause is deliberately the stricter of the two.
  const canWriteToEveryBooking =
    role === OrganizationRoles.ADMIN || role === OrganizationRoles.OWNER;

  if (canWriteToEveryBooking) {
    return undefined;
  }

  // Mirrors the `checkCustodianOnly: false` branch below: creator OR custodian.
  return { OR: [{ creatorId: userId }, { custodianUserId: userId }] };
}

interface ValidateBookingOwnershipParams {
  booking: {
    creatorId: string | null;
    custodianUserId: string | null;
  };
  userId: string;
  role: OrganizationRoles;
  action: string;
  /**
   * When true, only checks custodianUserId (not creatorId).
   * Used for operations like PDF/calendar download where only the custodian should have access.
   * @default false
   */
  checkCustodianOnly?: boolean;
  /**
   * When true, BASE users are blocked entirely (used for destructive actions like extend/delete).
   * When false, BASE users are checked for ownership like SELF_SERVICE (used for read operations).
   * @default false
   */
  blockBaseEntirely?: boolean;
}

/**
 * Validates that a user has permission to perform an action on a booking based on their role and ownership.
 *
 * Authorization rules:
 * - BASE users: Blocked for write operations, ownership-checked for read operations
 * - SELF_SERVICE users: Only allowed on bookings they own (creator OR custodian)
 * - ADMIN/OWNER users: Allowed on all bookings
 *
 * @throws {ShelfError} 403 if user is not authorized
 */
/**
 * Picks the most privileged role from a membership's role array.
 *
 * `roles` is an array and the codebase conventionally reads `roles[0]`, which
 * is fine for display and wrong for authorization: a membership ordered
 * `[SELF_SERVICE, ADMIN]` resolves to SELF_SERVICE, so an actual admin is
 * treated as restricted and refused. {@link validateBookingOwnership} only
 * distinguishes privileged (ADMIN/OWNER, allowed through) from restricted
 * (SELF_SERVICE/BASE, owner-only), so it needs the privileged answer.
 *
 * @param roles - Every role on the membership
 * @returns OWNER or ADMIN when present, otherwise `roles[0]`, defaulting to BASE
 */
export function resolveMostPrivilegedRole(
  roles: OrganizationRoles[]
): OrganizationRoles {
  return (
    ROLE_PRECEDENCE.find((candidate) => roles.includes(candidate)) ??
    roles[0] ??
    OrganizationRoles.BASE
  );
}

export function validateBookingOwnership({
  booking,
  userId,
  role,
  action,
  checkCustodianOnly = false,
  blockBaseEntirely = false,
}: ValidateBookingOwnershipParams): void {
  if (role === OrganizationRoles.BASE && blockBaseEntirely) {
    throw new ShelfError({
      cause: null,
      label: "Booking",
      message: `You are not authorized to ${action} this booking.`,
      status: 403,
      shouldBeCaptured: false,
    });
  }

  if (
    role === OrganizationRoles.SELF_SERVICE ||
    role === OrganizationRoles.BASE
  ) {
    const isBookingOwner = checkCustodianOnly
      ? booking.custodianUserId === userId
      : booking.creatorId === userId || booking.custodianUserId === userId;

    if (!isBookingOwner) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        message: `You are not authorized to ${action} this booking.`,
        status: 403,
        shouldBeCaptured: false,
      });
    }
  }

  // ADMIN and OWNER roles are implicitly allowed - no check needed
}

/**
 * Whether a role is one of the two restricted, "own records only" roles.
 *
 * @param role - Effective role from `resolveEffectiveRole` (web) or
 *   {@link resolveMostPrivilegedRole} (mobile).
 * @returns `true` for SELF_SERVICE and BASE.
 */
export function isSelfServiceOrBaseRole(role: OrganizationRoles): boolean {
  return (
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE
  );
}

/**
 * Whether the caller may see bookings they are not the custodian of.
 *
 * ADMIN / OWNER always can. SELF_SERVICE and BASE only can when the workspace
 * has switched the corresponding setting on. This is the standard visibility
 * rule for bookings; every read path that can surface someone else's booking
 * gates on it, on web (`/bookings`, the command palette, CSV export) and on
 * mobile (the list, the calendar, the booking detail, the dashboard).
 *
 * Exported so callers outside `requirePermission` resolve it identically. A
 * surface that invents its own rule disagrees with the loader that seeded it -
 * a picker whose list changes the moment the user types, or two platforms that
 * disagree about which bookings exist.
 *
 * READ only. It never widens a mutation: a restricted user may legitimately
 * view a booking they cannot write to. Writes stay on the role's permission
 * grant plus {@link validateBookingOwnership} / {@link bookingWriteScopeClause}.
 *
 * Lives here rather than in `roles.server.ts` so the mobile API can reach it:
 * that module pulls in Sentry and the organization service, and through it
 * Stripe and the mailer, which no mobile route or its test can carry. This
 * module imports only Prisma types and two local helpers - keep it that way.
 *
 * @param args.role - The caller's effective role.
 * @param args.currentOrganization - Workspace whose override settings apply.
 * @returns `true` when bookings should NOT be restricted to the caller's own.
 */
export function resolveCanSeeAllBookings({
  role,
  currentOrganization,
}: {
  role: OrganizationRoles;
  currentOrganization: {
    selfServiceCanSeeBookings: boolean;
    baseUserCanSeeBookings: boolean;
  };
}): boolean {
  return (
    // Admin/Owner always can see all
    !isSelfServiceOrBaseRole(role) ||
    // SELF_SERVICE can see all if org setting allows
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeBookings) ||
    // BASE can see all if org setting allows
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeBookings)
  );
}
