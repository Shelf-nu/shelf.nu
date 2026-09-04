import type { Booking, Currency } from "@prisma/client";
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "./badge-colors";
import { formatCurrency } from "./currency";
import type { UserNameFields } from "./user";
import { resolveTeamMemberName } from "./user";

/**
 * Whether a booking is a reservation request still waiting for an admin's
 * approval. Derived — there is no PENDING status: a RESERVED booking with no
 * `approvedAt` in an org that requires approval is pending. Client-safe; the
 * server-side checkout guard (`assertBookingIsApproved`) derives from this
 * same function so UI and service can never disagree.
 */
export function isBookingPendingApproval({
  status,
  approvedAt,
  requireBookingApproval,
}: {
  status: BookingStatus;
  approvedAt: Date | string | null;
  requireBookingApproval: boolean;
}): boolean {
  return (
    requireBookingApproval &&
    status === BookingStatus.RESERVED &&
    approvedAt === null
  );
}

export function canUserManageBookingAssets(
  booking: Pick<Booking, "status" | "from" | "to">,
  isSelfService: boolean
) {
  const isCompleted = booking.status === BookingStatus.COMPLETE;
  const isArchived = booking.status === BookingStatus.ARCHIVED;
  const isCancelled = booking.status === BookingStatus.CANCELLED;

  const cantManageAssetsAsSelfService =
    isSelfService && booking.status !== BookingStatus.DRAFT;

  return (
    !isCompleted &&
    !isArchived &&
    !isCancelled &&
    !cantManageAssetsAsSelfService
  );
}

/**
 * The statuses a booking is still open to item removal in — every status that
 * is not a closed record (COMPLETE, ARCHIVED, CANCELLED).
 *
 * Spelled as an explicit list so {@link REMOVABLE_STATUSES_BY_ROLE} can say
 * "unrestricted" by reference instead of restating it and drifting from it.
 */
const REMOVABLE_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Whether items may still be REMOVED from a booking in its current status.
 *
 * Removal stays open until the booking is finished — a booking that is
 * COMPLETE, ARCHIVED or CANCELLED is a closed record and its contents must not
 * change.
 *
 * Status-only, unlike {@link canUserManageBookingAssets}: this is the
 * closed-record half of the rule and every remove path needs it, including the
 * services, which have no role in scope. Callers acting on behalf of a user
 * want {@link canRoleRemoveBookingAssets}, which adds the role half.
 *
 * Ownership remains the caller's to enforce either way.
 *
 * @param booking - The booking being modified; only `status` is consulted
 * @returns `true` when the booking is still open to item removal
 */
export function canUserRemoveBookingAssets(booking: Pick<Booking, "status">) {
  return REMOVABLE_STATUSES.includes(booking.status);
}

/**
 * Statuses in which a restricted role may still remove items from a booking
 * it owns.
 *
 * BASE stops at DRAFT: once a booking is reserved, a BASE custodian is already
 * refused the ADD half of the same operation (`canUserManageBookingAssets`,
 * and the DRAFT-only gate in the manage-assets / manage-kits routes), which
 * tells them to cancel and recreate the booking instead. SELF_SERVICE keeps
 * RESERVED because that role is trusted to adjust its own reservation before
 * pickup.
 *
 * Neither role reaches ONGOING or OVERDUE. Removing an asset from a live
 * booking reconciles that asset's status back to available (see `removeAssets`
 * in `booking/service.server.ts`), which is a return — and returns are
 * `booking:checkin`, an action neither role holds on its own booking.
 */
const REMOVABLE_STATUSES_BY_ROLE: Record<OrganizationRoles, BookingStatus[]> = {
  [OrganizationRoles.BASE]: [BookingStatus.DRAFT],
  [OrganizationRoles.SELF_SERVICE]: [
    BookingStatus.DRAFT,
    BookingStatus.RESERVED,
  ],
  // Unrestricted beyond the closed-record rule, mirroring the ADMIN/OWNER
  // allow-all short-circuit in `@shelf/permissions`.
  [OrganizationRoles.ADMIN]: REMOVABLE_STATUSES,
  [OrganizationRoles.OWNER]: REMOVABLE_STATUSES,
};

/**
 * Whether the acting user's roles may remove items from a booking in its
 * current status.
 *
 * The role half of the question {@link canUserRemoveBookingAssets} leaves open.
 * `booking:update` is the permission every remove path checks and BASE holds
 * it, so the permission matrix alone does not answer this — every surface that
 * offers or performs a removal has to ask here.
 *
 * Takes an ARRAY and resolves it with `.some()`, matching `roleHasPermission`
 * in `@shelf/permissions`: a membership carries a role list, and reading
 * `roles[0]` for an authorization decision resolves `[SELF_SERVICE, ADMIN]` to
 * the restricted answer.
 *
 * Ownership is still the caller's to enforce: this answers "may these roles act
 * at this status", not "is this their booking".
 *
 * @param roles - The acting user's roles in the booking's organization. Empty
 *   or `undefined` denies, the safe direction while a session is still loading.
 * @param booking - The booking being modified; only `status` is consulted
 * @returns `true` when those roles may remove items at this status
 */
export function canRoleRemoveBookingAssets({
  roles,
  booking,
}: {
  roles: OrganizationRoles[] | undefined;
  booking: Pick<Booking, "status">;
}) {
  if (!roles?.length) {
    return false;
  }

  if (!canUserRemoveBookingAssets(booking)) {
    return false;
  }

  // ALLOW-list, not a deny-list, and typed as a total `Record` so a role added
  // to the enum later fails to compile in the map instead of silently
  // inheriting unrestricted removal. Same discipline as
  // `bookingWriteScopeFilter` in `booking-authorization.server.ts`.
  return roles.some(
    (role) => REMOVABLE_STATUSES_BY_ROLE[role]?.includes(booking.status)
  );
}

export const bookingStatusColorMap: {
  [key in BookingStatus]: BadgeColorScheme;
} = {
  DRAFT: BADGE_COLORS.gray,
  RESERVED: BADGE_COLORS.blue,
  ONGOING: BADGE_COLORS.violet,
  OVERDUE: BADGE_COLORS.red,
  COMPLETE: BADGE_COLORS.green,
  ARCHIVED: BADGE_COLORS.gray,
  CANCELLED: BADGE_COLORS.gray,
};

/**
 * Calculates the total value of booked items in a booking.
 *
 * The multiplier is **`bookedQuantity`** — the units the booking actually
 * reserved (from `BookingAsset.quantity`), NOT `Asset.quantity` (total
 * workspace stock). For a QT asset stocked at 100 with 5 booked, the
 * contribution is `valuation × 5`, not `valuation × 100`. Booking a
 * single asset across multiple slices (standalone + kit, or two kits)
 * naturally sums correctly: each slice contributes its own bookedQuantity.
 *
 * Callers always project from `booking.bookingAssets`. Do not pass
 * spread asset rows — they carry stock quantity and would overcharge.
 *
 * @param assets - Per-slice projection: `{ valuation, bookedQuantity }`.
 * @param currency - Workspace currency.
 * @param locale - UI locale for number formatting.
 * @returns Formatted total (e.g. `"$300.00"`).
 */
/** Resolve custodian display name from booking data */
export function getBookingCustodianName(booking: {
  custodianTeamMember?: { name: string } | null;
  custodianUser?: UserNameFields | null;
}): string | null {
  if (booking.custodianTeamMember) {
    return resolveTeamMemberName({
      name: booking.custodianTeamMember.name,
    });
  }
  if (booking.custodianUser) {
    return resolveTeamMemberName({
      name: "",
      user: booking.custodianUser,
    });
  }
  return null;
}

export function calculateTotalValueOfAssets({
  assets,
  currency,
  locale,
}: {
  assets: {
    /** Per-unit price (`Asset.valuation`). May be null when not set. */
    valuation: number | null;
    /**
     * Booked units for this slice (`BookingAsset.quantity`). INDIVIDUAL
     * assets always have `1`. Defaults to `1` defensively if missing so a
     * malformed input never explodes; callers should always supply it.
     */
    bookedQuantity: number | null;
  }[];
  currency: Currency;
  locale: string;
}): string {
  // Multiplies per-unit `valuation` by `bookedQuantity` — the units the
  // booking actually reserved. Asset stock quantity is irrelevant to a
  // booking total; using it would overcharge for QT assets where the
  // booking holds only a slice of the pool. See JSDoc above.
  const value = assets.reduce(
    (acc, { valuation, bookedQuantity }) =>
      acc + (valuation ?? 0) * (bookedQuantity ?? 1),
    0
  );
  return formatCurrency({
    value: value,
    locale,
    currency,
  });
}
