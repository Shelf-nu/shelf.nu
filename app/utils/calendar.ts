import type { BookingStatus } from "@prisma/client";

export function getStatusClasses(status: BookingStatus) {
  /** Default classes */
  const classes = [
    "text-sm",
    "font-normal",
    "py-[2px] px-[5px]",
    "hover:bg-blue-700 focus:!bg-blue-700",
    "hover:!border-blue-700 focus:!border-blue-700",
    "hover:!text-blue-50 focus:!text-blue-50",
    "hover:cursor-pointer",
  ];
  let statusClasses: string[] = [];
  switch (status) {
    case "DRAFT":
    case "ARCHIVED":
    case "CANCELLED":
      statusClasses = ["!text-gray-700", "bg-gray-50", "border-gray-200"];
      break;
    case "RESERVED":
      statusClasses = ["!text-blue-700", "bg-blue-50", "border-blue-200"];
      break;
    case "ONGOING":
      statusClasses = ["!text-purple-700", "bg-purple-50", "border-purple-200"];
      break;
    case "OVERDUE":
      statusClasses = [
        "!text-warning-700",
        "bg-warning-50",
        "border-warning-200",
      ];
      break;
    case "COMPLETE":
      statusClasses = [
        "!text-success-700",
        "bg-success-50",
        "border-success-200",
      ];
      break;
    default:
      break;
  }

  return [...classes, ...statusClasses];
}
