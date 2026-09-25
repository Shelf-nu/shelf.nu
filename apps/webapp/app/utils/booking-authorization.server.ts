import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { ShelfError } from "./error";
import type { BookingStatusName, RoleAccess } from "./permissions/role-access";
import { resolveMostPrivilegedRole } from "./role-precedence";
import { resolveBookingHolderName, type UserNameFields } from "./user";

// The resolver lives in role-precedence.ts so client gates can share it; server
// callers keep importing it from here.
export { resolveMostPrivilegedRole };

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
 * @param params.access - The caller's access; `bookings.seeAll` covers roles
 *   that see every booking and restricted roles whose workspace toggle is on.
 * @param params.booking - The booking's two custody links.
 * @param params.userId - The requester.
 * @returns `true` if the requester may see this booking.
 */
export function canSeeBooking({
  access,
  booking,
  userId,
}: {
  access: RoleAccess;
  booking: BookingCustodyLinks;
  userId: string;
}): boolean {
  return access.bookings.seeAll || isBookingCustodian({ booking, userId });
}

/**
 * Whether the caller holds a booking, through EITHER custody link.
 *
 * A booking assigned by picking a team member can carry
 * `custodianUserId = NULL`, so matching the user link alone misses bookings
 * that belong to the caller. This is the custody half of {@link canSeeBooking},
 * for callers that need "is it theirs" without the workspace see-toggle.
 *
 * @param params.booking - The booking's two custody links
 * @param params.userId - The caller
 * @returns `true` when either link names the caller
 */
export function isBookingCustodian({
  booking,
  userId,
}: {
  booking: BookingCustodyLinks;
  userId: string;
}): boolean {
  return (
    booking.custodianUserId === userId ||
    booking.custodianTeamMember?.userId === userId
  );
}

/**
 * Refuses a booking PDF / .ics download the caller may not have.
 *
 * Roles whose policy grants `bookings.documentsForOthers` download any
 * booking's documents; everyone else only a booking they are the custodian of
 * (the user link). Creating the booking is not enough, and the booking
 * see-toggle does not widen this.
 *
 * @param params.access - The caller's access
 * @param params.booking - The booking's user custody link
 * @param params.userId - The caller
 * @param params.action - Verb phrase for the refusal ("view", "download the calendar for")
 * @throws {ShelfError} 403 when the caller may not download this booking's documents
 */
export function assertCanDownloadBookingDocuments({
  access,
  booking,
  userId,
  action,
}: {
  access: RoleAccess;
  booking: { custodianUserId: string | null };
  userId: string;
  action: string;
}): void {
  if (
    access.policy.bookings.documentsForOthers ||
    booking.custodianUserId === userId
  ) {
    return;
  }

  throw new ShelfError({
    cause: null,
    label: "Booking",
    message: `You are not authorized to ${action} this booking.`,
    status: 403,
    shouldBeCaptured: false,
  });
}

/**
 * The query-side mirror of {@link validateBookingOwnership}: the set of
 * bookings a caller may MUTATE (add assets/kits to, edit, ...).
 *
 * A picker whose whole purpose is to choose a mutation target has to offer the
 * SAME set the submit-time gate accepts, or the user selects a row the action
 * then refuses. Both read `access.bookings.writeAll`, which the workspace
 * see-toggles never widen.
 *
 * Matches only `custodianUserId`, like the gate, not the team-member custody
 * link: offering a row the gate refuses would restore the 403. Widening both
 * together has to sweep every `validateBookingOwnership` call site.
 *
 * @param params.userId - The caller
 * @param params.access - The caller's access
 * @returns A `Prisma.BookingWhereInput` to AND into the query, or `undefined`
 *   when the caller may write every booking in the workspace
 */
export function bookingWriteScopeClause({
  userId,
  access,
}: {
  userId: string;
  access: RoleAccess;
}): Prisma.BookingWhereInput | undefined {
  if (access.bookings.writeAll) {
    return undefined;
  }
  return { OR: [{ creatorId: userId }, { custodianUserId: userId }] };
}

interface ValidateBookingOwnershipParams {
  booking: {
    creatorId: string | null;
    custodianUserId: string | null;
  };
  userId: string;
  /** The caller's access; `bookings.writeAll` skips the ownership check. */
  access: RoleAccess;
  /** Verb phrase for the refusal message ("check out", "cancel", ...). */
  action: string;
}

/**
 * Refuses a write to a booking the caller does not own.
 *
 * A caller whose access writes every booking passes. Everyone else must have
 * created the booking or hold it through the user custody link. The workspace
 * see-toggles do not widen this: seeing a booking never grants writing it.
 *
 * @param params.booking - The booking's creator and user custody link
 * @param params.userId - The caller
 * @param params.access - The caller's access
 * @param params.action - Verb phrase for the refusal message
 * @throws {ShelfError} 403 when the caller may not write this booking
 */
export function validateBookingOwnership({
  booking,
  userId,
  access,
  action,
}: ValidateBookingOwnershipParams): void {
  if (access.bookings.writeAll) {
    return;
  }

  const isBookingOwner =
    booking.creatorId === userId || booking.custodianUserId === userId;

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

/**
 * Refuses deleting a booking the caller may not delete.
 *
 * Ownership first ({@link validateBookingOwnership}), then the policy's draft
 * rule: roles with `bookings.deleteOnlyDrafts` delete only DRAFT bookings.
 * Every singular delete path runs this (the web booking page and the mobile
 * endpoint), and bulk delete applies the same draft rule to its whole
 * selection.
 *
 * @param params.access - The caller's access
 * @param params.booking - Ownership links and status of the booking
 * @param params.userId - The caller
 * @throws {ShelfError} 403 when the caller may not delete this booking
 */
export function assertCanDeleteBooking({
  access,
  booking,
  userId,
}: {
  access: RoleAccess;
  booking: {
    creatorId: string | null;
    custodianUserId: string | null;
    status: BookingStatusName;
  };
  userId: string;
}): void {
  validateBookingOwnership({ booking, userId, access, action: "delete" });

  if (access.policy.bookings.deleteOnlyDrafts && booking.status !== "DRAFT") {
    throw new ShelfError({
      cause: null,
      label: "Booking",
      message:
        "You are not authorized to delete this booking. Only draft bookings can be deleted.",
      status: 403,
      shouldBeCaptured: false,
    });
  }
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

/**
 * The name shown in place of a custodian the viewer may not see.
 *
 * The literal the web badge draws (`TeamMemberBadge`), so a booking redacted
 * on one platform reads the same on the other. Distinct from `null`, which
 * means the booking has no custodian at all — collapsing the two reports an
 * unassigned booking as a withheld one.
 */
export const WITHHELD_CUSTODIAN_NAME = "private";

/**
 * The custody links a booking row needs for its custodian to be named.
 *
 * Both `custodianUser.id` and `custodianTeamMember.userId` are REQUIRED, and
 * that is the point: they are what answer "is the custodian the caller?", so a
 * query that omits either silently redacts a user's own booking. Required
 * fields turn that into a compile error instead.
 *
 * `custodianUser` carries {@link UserNameFields} rather than the name halves
 * spelled out, so a projection cannot drift back to naming someone by their
 * legal name without failing to compile.
 */
export type BookingCustodianLinks = {
  custodianUser?: (UserNameFields & { id: string }) | null;
  custodianTeamMember?: { name: string; userId: string | null } | null;
};

/**
 * Whether this viewer may see WHO holds a booking.
 *
 * Separate from {@link canSeeBooking}, and gated by a separate workspace
 * override: seeing that a booking exists does not mean seeing who has it. A
 * workspace may grant either without the other.
 *
 * The caller always sees their own name, through EITHER custody link — a
 * booking assigned by picking a team member carries `custodianUserId = NULL`,
 * so matching the user link alone hides a booking's holder from the very
 * person holding it.
 *
 * @param params.canSeeAllCustody - Whether the workspace lets this role see
 *   custody it does not hold (ADMIN/OWNER, or a granted override).
 * @param params.booking - The booking's two custody links.
 * @param params.userId - The viewer.
 * @returns `true` when the custodian may be named to this viewer.
 */
export function canSeeBookingCustodian({
  canSeeAllCustody,
  booking,
  userId,
}: {
  canSeeAllCustody: boolean;
  booking: BookingCustodianLinks;
  userId: string;
}): boolean {
  return (
    canSeeAllCustody ||
    booking.custodianUser?.id === userId ||
    booking.custodianTeamMember?.userId === userId
  );
}

/**
 * The custodian name a booking row should carry for this viewer.
 *
 * Three distinct answers, and the app renders each differently: a name, `null`
 * for "this booking has no custodian", and {@link WITHHELD_CUSTODIAN_NAME} for
 * "it has one you may not see".
 *
 * The name itself comes from {@link resolveBookingHolderName}, which the web
 * asset and kit custody cards also use, so no surface names a holder
 * differently.
 *
 * Shared by the mobile list, calendar, dashboard and asset detail so every
 * lens on the same booking agrees about who holds it.
 *
 * @param params.canSeeAllCustody - Whether custody may be shown to this viewer.
 * @param params.booking - The booking's two custody links.
 * @param params.userId - The viewer.
 * @returns The custodian's name, `null` when there is none, or the withheld
 *   sentinel when there is one this viewer may not see.
 */
export function resolveBookingCustodianName({
  canSeeAllCustody,
  booking,
  userId,
}: {
  canSeeAllCustody: boolean;
  booking: BookingCustodianLinks;
  userId: string;
}): string | null {
  if (!booking.custodianUser && !booking.custodianTeamMember) {
    return null;
  }

  if (!canSeeBookingCustodian({ canSeeAllCustody, booking, userId })) {
    return WITHHELD_CUSTODIAN_NAME;
  }

  return resolveBookingHolderName(booking);
}
