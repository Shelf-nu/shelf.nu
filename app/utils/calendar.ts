import type { BookingStatus } from "@prisma/client";

export function getStatusClasses(
  status: BookingStatus,
  oneDayEvent: boolean = false
) {
  /** Default classes */
  const classes = [
    "text-sm",
    "!mx-1",
    "transition-colors",
    "!rounded-[4px]",
    "!font-normal",
    "py-[2px] px-[5px]",
    "hover:bg-blue-700 focus:!bg-blue-700",
    "hover:!border-blue-700 focus:!border-blue-700",
    "hover:!text-blue-50 focus:!text-blue-50",
    "hover:cursor-pointer",
  ];
  if (oneDayEvent) {
    classes.push(
      "!bg-transparent hover:!bg-blue-700 [&>div.fc-daygrid-event-dot]:hover:!border-white"
    );
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
      ];
      break;
    case "RESERVED":
      statusClasses = [
        "!text-blue-700",
        "bg-blue-50",
        "border-blue-200",
        "[&>div.fc-daygrid-event-dot]:!border-blue-700",
      ];
      break;
    case "ONGOING":
      statusClasses = [
        "!text-purple-700",
        "bg-purple-50",
        "border-purple-200",
        "[&>div.fc-daygrid-event-dot]:!border-purple-700",
      ];
      break;
    case "OVERDUE":
      statusClasses = [
        "!text-warning-700",
        "bg-warning-50",
        "border-warning-200",
        "[&>div.fc-daygrid-event-dot]:!border-warning-700",
      ];
      break;
    case "COMPLETE":
      statusClasses = [
        "!text-success-700",
        "bg-success-50",
        "border-success-200",
        "[&>div.fc-daygrid-event-dot]:!border-success-700",
      ];
      break;
    default:
      break;
  }

  return [...classes, ...statusClasses];
}

export function isOneDayEvent(from: Date, to: Date) {
  const start = new Date(from);
  const end = new Date(to);

  const isSameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  return isSameDay;
}
