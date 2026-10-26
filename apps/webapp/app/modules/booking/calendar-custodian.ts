/**
 * Calendar Event Custodian
 *
 * Shapes the custodian a calendar event carries to the client. The calendar
 * hover card renders it with `TeamMemberBadge`, which hides a custodian the
 * viewer may not see; this projection makes the payload match, so a hidden
 * custodian's name and ids never leave the server.
 *
 * Dependency-free so it can be unit-tested without the booking service.
 *
 * @see {@link file://./service.server.ts} `getBookingsForCalendar`
 * @see {@link file://./../../components/calendar/event-card.tsx}
 */

/** The booking fields the projection reads */
type CalendarCustodianBooking = {
  custodianTeamMemberId: string | null;
  custodianUserId: string | null;
  custodianUser: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    profilePicture: string | null;
  } | null;
};

/**
 * Builds the `custodian` of a calendar event.
 *
 * Mirrors `userCanViewSpecificCustody`: the viewer sees their own custody,
 * and everyone else's only when they may see all custody. A hidden custodian
 * keeps the shape with every identifying field emptied, so the badge still
 * receives a custodian and hides it.
 *
 * @param args.booking - The booking row, with its custodian user selected
 * @param args.custodianName - The resolved display name of the custodian
 * @param args.viewerUserId - The user loading the calendar
 * @param args.canSeeAllCustody - Whether the viewer may see everyone's custody
 * @returns The custodian for the event's `extendedProps`
 */
export function buildCalendarCustodian({
  booking,
  custodianName,
  viewerUserId,
  canSeeAllCustody,
}: {
  booking: CalendarCustodianBooking;
  custodianName: string | undefined;
  viewerUserId: string;
  canSeeAllCustody: boolean;
}) {
  const isOwnCustody =
    !!booking.custodianUserId && booking.custodianUserId === viewerUserId;

  if (!canSeeAllCustody && !isOwnCustody) {
    return { id: null, name: "", user: undefined };
  }

  return {
    id: booking.custodianTeamMemberId,
    name: custodianName,
    // Named field by field rather than spread: the loaded row is a full
    // `User`, and this payload is serialized to the calendar client.
    // `displayName` belongs on the list: it outranks the legal-name halves
    // wherever this custodian is rendered.
    user: booking.custodianUser
      ? {
          id: booking.custodianUserId,
          firstName: booking.custodianUser.firstName,
          lastName: booking.custodianUser.lastName,
          displayName: booking.custodianUser.displayName,
          profilePicture: booking.custodianUser.profilePicture,
        }
      : undefined,
  };
}
