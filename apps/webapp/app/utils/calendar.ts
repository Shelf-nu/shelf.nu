import type {
  CalendarApi,
  EventClickArg,
  EventHoveringArg,
} from "@fullcalendar/core";
import type { BookingStatus } from "@prisma/client";
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
import { getWeekStartingAndEndingDates } from "./date-fns";

/**
 * Class the availability hook puts on a bar whose asset has been checked in
 * from the booking. Read back by the hover handlers below, which repaint every
 * bar of a booking at once and must not turn a returned bar into a live one.
 */
export const RETURNED_EVENT_CLASS = "booking-returned";

/**
 * The status a calendar bar is DRAWN with. A returned bar borrows the
 * COMPLETE palette so it reads as settled, while `status` itself keeps the
 * booking's real value for the popover badge and any other status logic.
 */
export function calendarDisplayStatus(props: {
  status: BookingStatus;
  returned?: boolean;
}): BookingStatus {
  return props.returned ? "COMPLETE" : props.status;
}

/**
 * Classes for one bar on the availability calendar. A returned bar is drawn
 * with the COMPLETE palette and is never treated as a one-day event, because
 * that treatment strips the fill and the bar's point is its fill up to the
 * check-in time. Every other bar keeps the status and one-day rules as is.
 */
export function availabilityEventClassNames(
  props: { status: BookingStatus; returned?: boolean },
  start: Date | string | null,
  end: Date | string | null,
  viewType?: string
): string[] {
  const oneDay = props.returned ? false : isOneDayEvent(start, end);
  return getStatusClasses(calendarDisplayStatus(props), oneDay, viewType);
}

export function getStatusClasses(
  status: BookingStatus,
  oneDayEvent: boolean = false,
  viewType?: string
) {
  /** Default classes */
  const classes = [
    "text-sm",
    "transition-colors",
    "!rounded-[4px]",
    "!font-normal",
    "py-[2px] px-[5px]",
    "hover:cursor-pointer",
    "truncate",
  ];
  if (oneDayEvent) {
    classes.push("[&>.fc-event-title]:!truncate !bg-transparent");
  }
  let statusClasses: string[] = [];
  switch (status) {
    case "DRAFT":
    case "ARCHIVED":
    case "CANCELLED":
      statusClasses = [
        "md:!text-gray-700",
        "md:bg-gray-50",
        "md:border-gray-200",
        "[&_.fc-daygrid-event-dot]:!border-gray-700",
        "[&_.fc-list-event-dot]:!border-gray-700",
        "md:focus:!bg-gray-100",
      ];
      break;
    case "RESERVED":
      statusClasses = [
        "md:!text-blue-700",
        "md:bg-blue-50",
        "md:border-blue-200",
        "[&_.fc-daygrid-event-dot]:!border-blue-700",
        "[&_.fc-list-event-dot]:!border-blue-700",
        "md:focus:!bg-blue-100",
      ];
      break;
    case "ONGOING":
      statusClasses = [
        "md:!text-purple-700",
        "md:bg-purple-50",
        "md:border-purple-200",
        "[&_.fc-daygrid-event-dot]:!border-purple-700",
        "[&_.fc-list-event-dot]:!border-purple-700",
        "md:focus:!bg-purple-100",
      ];
      break;
    // Red, not amber. `bookingStatusColorMap` maps OVERDUE to red and every
    // other place a booking status is shown reads from it - the badge on the
    // bookings index, the booking detail, the asset page, the companion app.
    // The calendar was the only surface calling an overdue booking a warning.
    case "OVERDUE":
      statusClasses = [
        "md:!text-error-700",
        "md:bg-error-50",
        "md:border-error-200",
        "[&_.fc-daygrid-event-dot]:!border-error-700",
        "[&_.fc-list-event-dot]:!border-error-700",
        "md:focus:!bg-error-100",
      ];
      break;
    case "COMPLETE":
      statusClasses = [
        "md:!text-success-700",
        "md:bg-success-50",
        "md:border-success-200",
        "[&_.fc-daygrid-event-dot]:!border-success-700",
        "[&_.fc-list-event-dot]:!border-success-700",
        "md:focus:!bg-success-100",
      ];
      break;
    default:
      break;
  }
  if (viewType == "timeGridWeek" || viewType == "timeGridDay") {
    statusClasses.push(statusClassesOnHover[status]);
  }
  if (oneDayEvent && viewType == "dayGridMonth") {
    statusClasses.push("md: !bg-transparent");
  }
  return [...classes, ...statusClasses];
}

export const statusClassesOnHover: Record<BookingStatus, string> = {
  DRAFT: "md:!bg-gray-100",
  ARCHIVED: "md:!bg-gray-100",
  CANCELLED: "md:!bg-gray-100",
  RESERVED: "md:!bg-blue-100",
  ONGOING: "md:!bg-purple-100",
  OVERDUE: "md:!bg-error-100",
  COMPLETE: "md:!bg-success-100",
};

export function isOneDayEvent(
  from: Date | string | null,
  to: Date | string | null
) {
  if (!from || !to) {
    return false;
  }

  const start = new Date(from);
  const end = new Date(to);

  const isSameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  return isSameDay;
}

/**
 * Handles the mouse enter event for calendar events.
 * It applies a hover effect based on the event's status and the allowed view type.
 * @param allowedViewType - The view type(s) where the hover effect should be applied.
 */
export const handleEventMouseEnter =
  (allowedViewType: string | string[]) => (info: EventHoveringArg) => {
    // Show the new tab icon on hover
    const newTabIcon = info.el?.querySelector(
      ".external-link-icon"
    ) as HTMLElement | null;
    if (newTabIcon) {
      newTabIcon.classList.remove("hidden");
      newTabIcon.classList.add("inline-block");
    }

    const parent = info.el?.parentElement;
    const viewType = info.view.type;

    // Handle text truncation by removing right constraint
    if (
      parent &&
      info.el &&
      ["dayGridMonth", "resourceTimelineMonth"].includes(viewType)
    ) {
      // Store original right style for restoration later
      const originalRight = parent.style.right;
      const innerWrapper = info.el.querySelector(
        ".inner-event-card-wrapper"
      ) as HTMLElement;
      (info.el as any)._originalRight = originalRight;

      // Check if the element is likely truncated by comparing scroll width vs client width
      const isLikelyTruncated = innerWrapper?.clientWidth > info.el.clientWidth;

      if (isLikelyTruncated) {
        /** We handle it different per view */
        if (viewType === "dayGridMonth") {
          parent.style.width = innerWrapper.clientWidth + "px";
          parent.style.zIndex = "1000"; // Ensure it shows above other elements
          parent.style.overflow = "visible"; // Allow it to expand beyond its container
        } else {
          // Remove the right constraint to allow full expansion
          parent.style.right = "auto";
          // Add a higher z-index to ensure it shows above other elements
          parent.style.zIndex = "1000";
          // Ensure it can expand beyond its container
          parent.style.overflow = "visible";
        }
      }
    }

    if (Array.isArray(allowedViewType)) {
      if (!allowedViewType.includes(viewType)) return;
    } else {
      if (viewType !== allowedViewType) return;
    }

    const statusClass = info.event._def.extendedProps.status as BookingStatus;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.add(hoverClassForElement(element, statusClass));
    }
  };

/**
 * One booking spans several asset rows and the hover paints all of them, so
 * each row picks its own hover colour from what it is drawn as: a bar marked
 * returned takes the COMPLETE hover, every other bar takes the hover of the
 * booking's real status. Which bar the pointer is on does not matter.
 */
function hoverClassForElement(
  element: HTMLElement,
  bookingStatus: BookingStatus
): string {
  return element.classList.contains(RETURNED_EVENT_CLASS)
    ? statusClassesOnHover.COMPLETE
    : statusClassesOnHover[bookingStatus];
}

/**
 * Handles the mouse leave event for calendar events.
 * It removes the hover effect based on the event's status and the allowed view type.
 * @param allowedViewType - The view type(s) where the hover effect should be removed.
 */
export const handleEventMouseLeave =
  (allowedViewType: string | string[]) => (info: EventHoveringArg) => {
    // Hide the new-tab icon again when the pointer leaves
    const newTabIcon = info.el?.querySelector(
      ".external-link-icon"
    ) as HTMLElement | null;
    if (newTabIcon) {
      newTabIcon.classList.add("hidden");
      newTabIcon.classList.remove("inline-block");
    }

    const viewType = info.view.type;
    const parent = info.el?.parentElement;
    // Restore original right constraint
    if (
      parent &&
      info.el &&
      ["dayGridMonth", "resourceTimelineMonth"].includes(viewType)
    ) {
      const originalRight = (info.el as any)._originalRight;
      if (originalRight !== undefined) {
        // Clean up
        if (viewType === "dayGridMonth") {
          parent.style.removeProperty("width");
          parent.style.removeProperty("zIndex");
          parent.style.removeProperty("overflow");
        } else {
          parent.style.right = originalRight;
          parent.style.zIndex = "";
          parent.style.overflow = "";
        }
      }
    }

    if (Array.isArray(allowedViewType)) {
      if (!allowedViewType.includes(viewType)) return;
    } else {
      if (viewType !== allowedViewType) return;
    }

    const statusClass = info.event._def.extendedProps.status as BookingStatus;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.remove(hoverClassForElement(element, statusClass));
    }
  };

/**
 * Handles the click event on calendar events.
 * It prevents the default action and opens the event URL in a new tab.
 *
 * @param info - The event click argument containing information about the clicked event.
 */
export function handleEventClick(info: EventClickArg) {
  info.jsEvent.preventDefault();
  const event = info.event;
  window.open(
    event.extendedProps.url || `/bookings/${event.id}`,
    "_blank",
    "noopener,noreferrer"
  );
}

/**
 * Build the calendar header title + subtitle for the current view, formatting
 * every visible date through the user's resolved prefs (absolute).
 *
 * @param viewType - FullCalendar view name (…Week / …Day / month)
 * @param calendarApi - The CalendarApi instance to read the current date from
 * @param prefs - Resolved user format prefs
 */
export function getCalendarTitleAndSubtitle({
  viewType,
  calendarApi,
  prefs,
}: {
  viewType: string;
  calendarApi: CalendarApi;
  prefs: ResolvedFormatPrefs;
}) {
  const currentDate = calendarApi.getDate();
  const monthYear = formatDate(currentDate, prefs, {
    month: "long",
    year: "numeric",
    localeOnly: true,
  });

  let title = monthYear;
  let subtitle = "";

  if (viewType.endsWith("Week")) {
    const [startingDay, endingDay] = getWeekStartingAndEndingDates(
      currentDate,
      prefs
    );

    title = monthYear;
    subtitle = `Week ${startingDay} - ${endingDay}`;
  } else if (viewType.endsWith("Day")) {
    const formattedDate = formatDate(currentDate, prefs, {
      day: "numeric",
      month: "long",
      year: "numeric",
      localeOnly: true,
    });
    const weekday = formatDate(currentDate, prefs, {
      weekday: "long",
      localeOnly: true,
    });
    title = formattedDate;
    subtitle = weekday;
  }

  return { title, subtitle };
}

export const scrollToNow = () => {
  setTimeout(() => {
    const nowIndicator = document.querySelector(
      ".fc-timeline-now-indicator-line"
    ) as HTMLElement;

    if (nowIndicator) {
      const scroller = nowIndicator.closest(".fc-scroller") as HTMLElement;

      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        const indicatorRect = nowIndicator.getBoundingClientRect();

        // Check if the now indicator is visible in the horizontal scroll area
        const isVisible =
          indicatorRect.left >= scrollerRect.left &&
          indicatorRect.right <= scrollerRect.right;

        if (!isVisible) {
          // Calculate scroll position to center the now indicator in the view
          const scrollLeft = nowIndicator.offsetLeft - scroller.clientWidth / 2;

          scroller.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: "smooth",
          });
        }
      }
    }
  }, 500);
};
