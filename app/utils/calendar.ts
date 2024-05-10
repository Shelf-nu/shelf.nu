import type { BookingStatus } from "@prisma/client";

export function getStatusClasses(
  status: BookingStatus,
  oneDayEvent: boolean = false
) {
  /** Default classes */
  const classes = [
    "text-sm",
    "transition-colors",
    "!rounded-[4px]",
    "!font-normal",
    "py-[2px] px-[5px]",
    "hover:cursor-pointer",
  ];
  if (oneDayEvent) {
    classes.push(" [&>.fc-event-title]:!truncate bg-transparent");
  }
  let statusClasses: string[] = [];
  switch (status) {
    case "DRAFT":
    case "ARCHIVED":
    case "CANCELLED":
      statusClasses = [
        "!text-gray-700",
        "bg-gray-50",
        "border-gray-200",
        "[&>div.fc-daygrid-event-dot]:!border-gray-700",
        "[&_.fc-list-event-dot]:!border-gray-700",
        "focus:!bg-gray-100",
      ];
      break;
    case "RESERVED":
      statusClasses = [
        "!text-blue-700",
        "bg-blue-50",
        "border-blue-200",
        "[&>div.fc-daygrid-event-dot]:!border-blue-700",
        "[&_.fc-list-event-dot]:!border-blue-700",
        "focus:!bg-blue-100",
      ];
      break;
    case "ONGOING":
      statusClasses = [
        "!text-purple-700",
        "bg-purple-50",
        "border-purple-200",
        "[&>div.fc-daygrid-event-dot]:!border-purple-700",
        "[&_.fc-list-event-dot]:!border-purple-700",
        "focus:!bg-purple-100",
      ];
      break;
    case "OVERDUE":
      statusClasses = [
        "!text-warning-700",
        "bg-warning-50",
        "border-warning-200",
        "[&>div.fc-daygrid-event-dot]:!border-warning-700",
        "[&_.fc-list-event-dot]:!border-warning-700",
        "focus:!bg-warning-100",
      ];
      break;
    case "COMPLETE":
      statusClasses = [
        "!text-success-700",
        "bg-success-50",
        "border-success-200",
        "[&>div.fc-daygrid-event-dot]:!border-success-700",
        "[&_.fc-list-event-dot]:!border-success-700",
        "focus:!bg-success-100",
      ];
      break;
    default:
      break;
  }

  return [...classes, ...statusClasses];
}
export const statusClassesOnHover: Record<BookingStatus, string> = {
  DRAFT: "!bg-gray-100",
  ARCHIVED: "!bg-gray-100",
  CANCELLED: "!bg-gray-100",
  RESERVED: "!bg-blue-100",
  ONGOING: "!bg-purple-100",
  OVERDUE: "!bg-warning-100",
  COMPLETE: "!bg-success-100",
};

export function isOneDayEvent(from: Date, to: Date) {
  const start = new Date(from);
  const end = new Date(to);

  const isSameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  return isSameDay;
}
