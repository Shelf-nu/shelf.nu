import type { EventContentArg } from "@fullcalendar/core";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { ArrowRightIcon } from "lucide-react";

import { type CalendarExtendedProps } from "~/routes/_layout+/calendar";
import { bookingStatusColorMap } from "~/utils/bookings";
import { isOneDayEvent } from "~/utils/calendar";
import { tw } from "~/utils/tw";
import { BookingStatusBadge } from "../booking/booking-status-badge";
import { DateS } from "../shared/date";
import { GrayBadge } from "../shared/gray-badge";
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

export default function renderEventCard({ event }: EventCardProps) {
  const viewType = event._context.calendarApi.view.type;
  const booking = event.extendedProps as CalendarExtendedProps;
  const _isOneDayEvent = isOneDayEvent(booking.start, booking.end);

  // Ref callback to set up scroll tracking
  const triggerRefCallback = (element: HTMLDivElement | null) => {
    if (!element) return;

    // Clean up previous setup if it exists
    const existingCleanup = (element as any)._cleanup;
    if (existingCleanup) {
      existingCleanup();
    }

    // Find the .fc-scroller container (the actual scrolling element)
    const fcScroller = element.closest(".fc-scroller") as Element;

    if (!fcScroller) {
      return;
    }

    // Store original position relative to the container when not scrolled
    let originalOffsetLeft: number;
    let elementWidth: number;
    let originalParentOffsetLeft: number;
    let parentWidth: number;

    const initializePosition = () => {
      // Reset any existing transforms to get true original position
      const currentTransform = element.style.transform;
      element.style.transform = "";

      const elementRect = element.getBoundingClientRect();
      const containerRect = fcScroller.getBoundingClientRect();
      const parentRect = element.parentElement!.getBoundingClientRect();

      originalOffsetLeft =
        elementRect.left - containerRect.left + fcScroller.scrollLeft;
      elementWidth = elementRect.width;
      originalParentOffsetLeft =
        parentRect.left - containerRect.left + fcScroller.scrollLeft;
      parentWidth = parentRect.width;

      // Restore transform if it existed
      element.style.transform = currentTransform;
    };

    // Initialize on first load
    setTimeout(initializePosition, 0);

    // Function to update position based on scroll
    const updatePosition = () => {
      if (
        originalOffsetLeft === undefined ||
        originalParentOffsetLeft === undefined
      )
        return;

      const containerRect = fcScroller.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const scrollLeft = fcScroller.scrollLeft;
      const buffer = 8;

      // Calculate where element would be without any transform
      const currentLeft = originalOffsetLeft - scrollLeft;
      const currentRight = currentLeft + elementWidth;

      // Calculate parent boundaries (where they would be without any transform)
      const parentLeft = originalParentOffsetLeft - scrollLeft;
      const parentRight = parentLeft + parentWidth;

      // Check if element would be clipped by scroll container (with buffer)
      const clippedLeft = currentLeft < buffer;
      const clippedRight = currentRight > containerWidth - buffer;

      let translateX = 0;

      if (clippedLeft && !clippedRight) {
        // Clipped on left, move right
        translateX = buffer - currentLeft;
      } else if (clippedRight && !clippedLeft) {
        // Clipped on right, move left
        translateX = containerWidth - buffer - currentRight;
      } else if (clippedLeft && clippedRight) {
        // Wider than container, keep left edge visible
        translateX = buffer - currentLeft;
      }

      // Apply parent div boundary constraints using original positions
      if (translateX !== 0) {
        // Calculate the maximum translation allowed within parent bounds
        const maxTranslateLeft = parentLeft - currentLeft; // How far left we can go
        const maxTranslateRight = parentRight - currentRight; // How far right we can go

        // Clamp translateX to stay within parent bounds
        translateX = Math.max(
          maxTranslateLeft,
          Math.min(maxTranslateRight, translateX)
        );
      }

      // Apply or reset transform
      if ((clippedLeft || clippedRight) && translateX !== 0) {
        element.style.transform = `translateX(${translateX}px)`;
        element.style.position = "relative";
        element.style.zIndex = "10";
      } else {
        element.style.transform = "";
        element.style.position = "";
        element.style.zIndex = "";
      }
    };

    // Set up scroll event listener
    const scrollHandler = () => {
      requestAnimationFrame(updatePosition);
    };

    // Set up resize observer to detect layout changes
    const resizeObserver = new ResizeObserver(() => {
      // Reinitialize position when layout changes
      setTimeout(() => {
        initializePosition();
        updatePosition();
      }, 0);
    });

    fcScroller.addEventListener("scroll", scrollHandler, { passive: true });
    resizeObserver.observe(fcScroller);

    // Also listen for window resize
    const windowResizeHandler = () => {
      setTimeout(() => {
        initializePosition();
        updatePosition();
      }, 50);
    };

    window.addEventListener("resize", windowResizeHandler);

    // Initial position check
    updatePosition();

    // Cleanup function
    const cleanup = () => {
      fcScroller.removeEventListener("scroll", scrollHandler);
      resizeObserver.disconnect();
      window.removeEventListener("resize", windowResizeHandler);
      element.style.transform = "";
      element.style.position = "";
      element.style.zIndex = "";
    };

    // Store cleanup function
    (element as any)._cleanup = cleanup;
  };

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <div
          className={tw(
            "!hover:bg-purple-100 flex items-center gap-1 whitespace-normal bg-transparent lg:truncate",
            event.extendedProps?.className
          )}
          style={{ color: bookingStatusColorMap[booking.status] }}
        >
          <div
            ref={triggerRefCallback}
            className="inner-event-card-wrapper inline-flex items-center gap-1 whitespace-nowrap"
          >
            {viewType === "dayGridMonth" && (
              <When truthy={_isOneDayEvent}>
                <div className="fc-daygrid-event-dot inline-block" />
              </When>
            )}
            <DateS date={booking.start} options={{ timeStyle: "short" }} /> |{" "}
            {event.title}
            <ExternalLinkIcon
              className={tw("external-link-icon mt-px", "hidden")}
            />
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          className="pointer-events-none z-[99999] md:w-auto md:max-w-[450px]"
          side="top"
          sideOffset={8}
          collisionPadding={16}
        >
          <EventCardContent booking={booking} />
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}

export function EventCardContent({
  booking,
}: {
  booking: CalendarExtendedProps;
}) {
  return (
    <>
      <div className="mb-3 mt-2 flex items-center gap-2 ">
        <div className="text-text-md font-medium">{booking.name}</div>
        <BookingStatusBadge
          status={booking.status}
          custodianUserId={booking.custodian.user?.id}
        />
      </div>

      <div className="mb-3 flex w-full items-center gap-x-2 text-sm text-gray-600">
        <DateS date={booking.start} options={DATE_FORMAT_OPTIONS} />
        <ArrowRightIcon className="size-3 text-gray-600" />
        <DateS date={booking.end} options={DATE_FORMAT_OPTIONS} />
      </div>

      <p className="mb-1 text-sm font-normal">Custodian:</p>
      <div className="mb-3 flex items-center gap-2">
        <TeamMemberBadge teamMember={booking.custodian} hidePrivate />
      </div>
      <p className="mb-1 text-sm font-normal">Created by:</p>
      <div className="mb-3 flex items-center gap-2">
        <TeamMemberBadge teamMember={booking.creator} hidePrivate />
      </div>
      {booking.tags && booking.tags.length ? (
        <>
          <p className="mb-1 text-sm font-normal">Tags:</p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {booking.tags.map((tag) => (
              <GrayBadge key={tag.id}>{tag.name}</GrayBadge>
            ))}
          </div>
        </>
      ) : null}

      {booking.description ? (
        <div className="wordwrap rounded border border-gray-200 bg-gray-25 p-2 text-gray-500">
          {booking.description}
        </div>
      ) : null}
    </>
  );
}
