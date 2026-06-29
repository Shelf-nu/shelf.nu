import type { Asset, Booking, Currency } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { getAssetTotalValue } from "./asset-value";
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
 * Calculates the total value of assets in a booking.
 * @param assets - Array of assets with their valuations.
 * @param currency - The currency in which the total value should be formatted.
 * @param locale - The locale for formatting the currency.
 * @returns A formatted string representing the total value of assets.
 * @example
 * const totalValue = calculateTotalValueOfAssets({
 *   assets: [{ valuation: 100 }, { valuation: 200 }],
 *   currency: "USD",
 *   locale: "en-US",
 * });
 * Returns "$300.00"
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
  // `quantity` is required so QT assets contribute valuation × quantity.
  // INDIVIDUAL assets always have quantity: 1, so behaviour is unchanged for them.
  assets: Pick<Asset, "valuation" | "quantity">[];
  currency: Currency;
  locale: string;
}): string {
  // QT-aware: multiplies valuation × quantity so qty-tracked assets are not silently underreported.
  const value = assets.reduce(
    (acc, asset) => acc + getAssetTotalValue(asset),
    0
  );
  return formatCurrency({
    value: value,
    locale,
    currency,
  });
}
