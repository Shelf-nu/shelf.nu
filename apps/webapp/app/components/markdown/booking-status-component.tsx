import { BookingStatus } from "@prisma/client";
import { PENDING_APPROVAL_NOTE_STATUS } from "~/utils/bookings";
import {
  BookingStatusBadge,
  PendingApprovalChip,
} from "../booking/booking-status-badge";

interface BookingStatusComponentProps {
  status: string;
  /**
   * Written by older notes. Ignored: the "subject to review" suffix it used to
   * unlock describes the booking as it is now, and a note records the status
   * at the time it was written.
   */
  custodianUserId?: string;
}

/** Every value the `booking_status` tag may render as a badge. */
const BOOKING_STATUSES = new Set<string>(Object.values(BookingStatus));

/**
 * BookingStatusComponent renders a booking status badge for use in Markdoc content.
 * This component wraps the existing BookingStatusBadge component to provide
 * consistent status visualization in activity notes and other markdown content.
 *
 * A note records the status at the moment it was written, so the badge shows
 * the plain status label, never the viewer-dependent "subject to review"
 * suffix. `PENDING_APPROVAL_NOTE_STATUS` renders the amber "Pending approval"
 * chip: a request is stored as RESERVED, but the note names the state the
 * requester sees.
 *
 * `status` comes from stored note content, which an injected tag can set to
 * anything. The badge looks its colours up by status and throws on an unknown
 * one, so anything that is not a real booking status renders as plain text.
 */
export function BookingStatusComponent({
  status,
}: BookingStatusComponentProps) {
  const value = String(status ?? "");
  if (value === PENDING_APPROVAL_NOTE_STATUS) {
    return <PendingApprovalChip />;
  }
  if (!BOOKING_STATUSES.has(value)) {
    return <span>{value}</span>;
  }

  return (
    <BookingStatusBadge
      status={value as BookingStatus}
      custodianUserId={undefined}
    />
  );
}
