import type { EventContentArg } from "@fullcalendar/core";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { ArrowRightIcon } from "lucide-react";
import { type CalendarExtendedProps } from "~/routes/_layout+/calendar";
import { bookingStatusColorMap } from "~/utils/bookings";
import { isOneDayEvent } from "~/utils/calendar";
import { tw } from "~/utils/tw";
import { BookingStatusBadge } from "../booking/booking-status-badge";
import { DateS } from "../shared/date";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import { TeamMemberBadge } from "../user/team-member-badge";
import When from "../when/when";

type EventCardProps = EventContentArg;

export const DATE_FORMAT_OPTIONS = {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
} as const;

export default function EventCard({ event }: EventCardProps) {
  const viewType = event._context.calendarApi.view.type;
  const booking = event.extendedProps as CalendarExtendedProps;
  const _isOneDayEvent = isOneDayEvent(booking.start, booking.end);

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <div
          className={tw(
            "inline-block size-full whitespace-normal bg-transparent lg:truncate"
          )}
          style={{ color: bookingStatusColorMap[booking.status] }}
        >
          {viewType == "dayGridMonth" && (
            <When truthy={_isOneDayEvent}>
              <div className="fc-daygrid-event-dot inline-block" />
            </When>
          )}
          <DateS
            date={booking.start}
            options={{
              timeStyle: "short",
            }}
          />{" "}
          | {event.title}
        </div>
      </HoverCardTrigger>

      <HoverCardPortal>
        <HoverCardContent
          className="pointer-events-none z-[99999] md:w-96"
          side="top"
        >
          <div className="flex w-full items-center gap-x-2 text-xs text-gray-600">
            <DateS date={booking.start} options={DATE_FORMAT_OPTIONS} />
            <ArrowRightIcon className="size-3 text-gray-600" />
            <DateS date={booking.end} options={DATE_FORMAT_OPTIONS} />
          </div>

          <div className="mb-3 mt-1 text-sm font-medium">{booking.name}</div>

          <div className="mb-3 flex items-center gap-2">
            <BookingStatusBadge
              status={booking.status}
              custodianUserId={booking.custodian.user?.id}
            />
            <TeamMemberBadge teamMember={booking.custodian} hidePrivate />
          </div>

          {booking.description ? (
            <div className="wordwrap rounded border border-gray-200 bg-gray-25 p-2 text-gray-500">
              {booking.description}
            </div>
          ) : null}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
