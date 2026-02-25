import type {
  CalendarApi,
  EventClickArg,
  EventHoveringArg,
} from "@fullcalendar/core";
import type { BookingStatus } from "@prisma/client";
import { getWeekStartingAndEndingDates } from "./date-fns";

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
    case "OVERDUE":
      statusClasses = [
        "md:!text-warning-700",
        "md:bg-warning-50",
        "md:border-warning-200",
        "[&_.fc-daygrid-event-dot]:!border-warning-700",
        "[&_.fc-list-event-dot]:!border-warning-700",
        "md:focus:!bg-warning-100",
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
  OVERDUE: "md:!bg-warning-100",
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

    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.add(statusClassesOnHover[statusClass]);
    }
  };

/**
 * Handles the mouse leave event for calendar events.
 * It removes the hover effect based on the event's status and the allowed view type.
 * @param allowedViewType - The view type(s) where the hover effect should be removed.
 */
export const handleEventMouseLeave =
  (allowedViewType: string | string[]) => (info: EventHoveringArg) => {
    // Show the new tab icon on hover
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

    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.remove(statusClassesOnHover[statusClass]);
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
    event.url || `/bookings/${event.id}`,
    "_blank",
    "noopener,noreferrer"
  );
}

/**
 * This function returns the title and subtitle for the calendar
 * based on the current view type.
 *
 * @param viewType - The type of the calendar view (e.g., resourceTimelineWeek, timeGridWeek)
 * @param calendar - The CalendarApi instance to get the current date.
 */
export function getCalendarTitleAndSubtitle({
  viewType,
  calendarApi,
}: {
  viewType: string;
  calendarApi: CalendarApi;
}) {
  const currentDate = calendarApi.getDate();
  const currentMonth = currentDate.toLocaleString("default", { month: "long" });
  const currentYear = currentDate.getFullYear();

  let title = `${currentMonth} ${currentYear}`;
  let subtitle = "";

  if (viewType.endsWith("Week")) {
    const [startingDay, endingDay] = getWeekStartingAndEndingDates(currentDate);

    title = `${currentMonth} ${currentYear}`;
    subtitle = `Week ${startingDay} - ${endingDay}`;
  } else if (viewType.endsWith("Day")) {
    const formattedDate = currentDate.toLocaleDateString("default", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const weekday = currentDate.toLocaleDateString("default", {
      weekday: "long",
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
