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

export const bookingStatusColorMap = (
  status: BookingStatus,
  theme: "light" | "dark" = "light"
): string => {
  const colors = {
    DRAFT: {
      light: "#667085", // gray-500
      dark: "#9CA3AF", // lighter gray for dark mode
    },
    RESERVED: {
      light: "#175CD3", // blue-700
      dark: "#60A5FA", // lighter blue for dark mode
    },
    ONGOING: {
      light: "#7A5AF8", // purple-500
      dark: "#A78BFA", // lighter purple for dark mode
    },
    OVERDUE: {
      light: "#B54708", // orange-700
      dark: "#F59E0B", // lighter orange for dark mode
    },
    COMPLETE: {
      light: "#17B26A", // green-600
      dark: "#34D399", // lighter green for dark mode
    },
    ARCHIVED: {
      light: "#667085", // gray-500
      dark: "#9CA3AF", // lighter gray for dark mode
    },
    CANCELLED: {
      light: "#667085", // gray-500
      dark: "#9CA3AF", // lighter gray for dark mode
    },
  };

  return colors[status][theme];
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
