import type { Asset, Booking, Currency } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { formatCurrency } from "./currency";

export function canUserManageBookingAssets(
  booking: Pick<Booking, "status"> & {
    from?: string | Date | null; // from is string in case if it is formatted
    to?: string | Date | null; // to is string in case if it is formatted
  },
  isSelfService: boolean
) {
  const isCompleted = booking.status === BookingStatus.COMPLETE;
  const isArchived = booking.status === BookingStatus.ARCHIVED;
  const isCancelled = booking.status === BookingStatus.CANCELLED;

  const cantManageAssetsAsSelfService =
    isSelfService && booking.status !== BookingStatus.DRAFT;

  return (
    !!booking.from &&
    !!booking.to &&
    !isCompleted &&
    !isArchived &&
    !isCancelled &&
    !cantManageAssetsAsSelfService
  );
}

export const bookingStatusColorMap: { [key in BookingStatus]: string } = {
  DRAFT: "#667085",
  RESERVED: "#175CD3",
  ONGOING: "#7A5AF8",
  OVERDUE: "#B54708",
  COMPLETE: "#17B26A",
  ARCHIVED: "#667085",
  CANCELLED: "#667085",
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
export function calculateTotalValueOfAssets({
  assets,
  currency,
  locale,
}: {
  assets: Pick<Asset, "valuation">[];
  currency: Currency;
  locale: string;
}): string {
  const value = assets.reduce((acc, asset) => acc + (asset.valuation || 0), 0);
  return formatCurrency({
    value: value,
    locale,
    currency,
  });
}
