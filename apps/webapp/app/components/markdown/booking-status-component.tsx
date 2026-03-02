import type { BookingStatus } from "@prisma/client";
import { BookingStatusBadge } from "../booking/booking-status-badge";

interface BookingStatusComponentProps {
  status: string;
  custodianUserId?: string;
}

/**
 * BookingStatusComponent renders a booking status badge for use in Markdoc content.
 * This component wraps the existing BookingStatusBadge component to provide
 * consistent status visualization in activity notes and other markdown content.
 */
export function BookingStatusComponent({
  status,
  custodianUserId,
}: BookingStatusComponentProps) {
  // Ensure the status is a valid BookingStatus enum value
  const bookingStatus = status as BookingStatus;

  return (
    <BookingStatusBadge
      status={bookingStatus}
      custodianUserId={custodianUserId}
    />
  );
}
