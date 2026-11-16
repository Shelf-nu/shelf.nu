import { BookingStatus } from "@prisma/client";
import { BookingStatusBadge } from "../booking/booking-status-badge";

interface BookingStatusComponentProps {
  status: string;
  custodianUserId?: string;
}

/** Every value the `booking_status` tag may render as a badge. */
const BOOKING_STATUSES = new Set<string>(Object.values(BookingStatus));

/**
 * BookingStatusComponent renders a booking status badge for use in Markdoc content.
 * This component wraps the existing BookingStatusBadge component to provide
 * consistent status visualization in activity notes and other markdown content.
 *
 * `status` comes from stored note content, which an injected tag can set to
 * anything. The badge looks its colours up by status and throws on an unknown
 * one, so anything that is not a real booking status renders as plain text.
 */
export function BookingStatusComponent({
  status,
  custodianUserId,
}: BookingStatusComponentProps) {
  const value = String(status ?? "");
  if (!BOOKING_STATUSES.has(value)) {
    return <span>{value}</span>;
  }

  return (
    <BookingStatusBadge
      status={value as BookingStatus}
      custodianUserId={custodianUserId}
    />
  );
}
