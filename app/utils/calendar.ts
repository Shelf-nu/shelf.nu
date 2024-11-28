import type { BookingStatus } from "@prisma/client";

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
    "max-h-[24px]",
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
  if (viewType == "dayGridMonth") {
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
  to: Date | string | null,
  viewDay?: string
) {
  if (!from || !to || viewDay != "dayGridMonth") {
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
