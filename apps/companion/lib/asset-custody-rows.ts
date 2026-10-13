/**
 * Custody rows for an asset held through a booking.
 *
 * For an INDIVIDUAL asset that is checked out on a booking, the asset detail
 * endpoint sends `activeBooking`: the booking, who holds the asset through it,
 * and whether this viewer may open it. This module lays that out as the
 * label/value rows the detail screen renders, the phone's form of the web
 * asset page's "In custody of {name} via {booking} Since {date}" card.
 *
 * Not a mirror of webapp logic: which booking, who may see it and who may
 * open it are all decided by the server. This module only decides which rows
 * exist and which one is tappable. It is pure and free of React Native, Expo
 * and `@/` paths so it runs under Node's test runner; the screen owns the
 * pixels and the navigation.
 *
 * @see {@link file://./asset-custody-rows.test.ts}
 * @see {@link file://../app/(tabs)/assets/[id].tsx} the only consumer
 * @see ../../webapp/app/routes/api+/mobile+/assets.$assetId.ts — the producer
 * @see ../../webapp/app/components/assets/asset-custody-card.tsx — the web card
 */
import type { AssetDetail } from "./api/types";

/** One label/value row on the asset detail screen: `InfoRow`'s props plus a key. */
export type CustodyInfoRow = {
  /** Stable React key for the row. */
  key: string;
  /** Ionicons glyph shown beside the label. */
  icon: string;
  /** The field label. */
  label: string;
  /** The field value. */
  value: string;
  /** Present only on a row the viewer may tap. */
  onPress?: () => void;
  /** A11y label, present only on a row the viewer may tap. */
  accessibilityLabel?: string;
};

/**
 * Builds the "custody through a booking" rows for the asset detail screen.
 *
 * Up to three rows, in order: who holds the asset, the booking, and since
 * when. The holder row is left out when the booking has no custodian. The
 * booking row opens the booking only when the server says this viewer may:
 * the booking screen refuses everyone else, so offering the tap to them would
 * end in an error.
 *
 * @param activeBooking - The detail endpoint's `activeBooking`, as received:
 *   `null` when there is nothing to show, absent on older servers
 * @param options.formatDateTime - Formats an ISO instant as date and time in
 *   the viewer's preferences
 * @param options.onOpenBooking - Opens the booking with the given id
 * @returns The rows to render, in order; empty when there is no booking
 */
export function buildBookingCustodyRows(
  activeBooking: AssetDetail["activeBooking"],
  {
    formatDateTime,
    onOpenBooking,
  }: {
    formatDateTime: (iso: string) => string;
    onOpenBooking: (bookingId: string) => void;
  }
): CustodyInfoRow[] {
  // Truthiness, not a shape check: an older server omits the field entirely.
  if (!activeBooking) return [];

  const { id, name, from, custodianName, canOpen } = activeBooking;
  const rows: CustodyInfoRow[] = [];

  if (custodianName) {
    rows.push({
      key: "booking-custodian",
      icon: "person-outline",
      label: "In Custody Of",
      value: custodianName,
    });
  }

  rows.push({
    key: "booking",
    icon: "calendar-outline",
    label: "Via Booking",
    value: name,
    ...(canOpen
      ? {
          onPress: () => onOpenBooking(id),
          accessibilityLabel: `View booking ${name}`,
        }
      : {}),
  });

  rows.push({
    key: "booking-since",
    icon: "time-outline",
    label: "Since",
    value: formatDateTime(from),
  });

  return rows;
}
