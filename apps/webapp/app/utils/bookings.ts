import type { Booking, Currency } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "./badge-colors";
import { formatCurrency } from "./currency";
import { resolveTeamMemberName } from "./user";

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
  custodianUser?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
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
