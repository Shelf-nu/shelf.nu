import { BookingStatus } from "@prisma/client";
import { Clock } from "lucide-react";
import { ONE_DAY, ONE_HOUR } from "~/utils/constants";

export function TimeRemaining({
  to,
  from,
  status,
}: {
  to: Date;
  from: Date;
  status: BookingStatus;
}) {
  const currentDate = new Date();

  // For these statuses, don't render anything (using direct comparison)
  if (
    status === BookingStatus.COMPLETE ||
    status === BookingStatus.ARCHIVED ||
    status === BookingStatus.CANCELLED
  ) {
    return null;
  }

  // For DRAFT and RESERVED, show time until start
  const isUpcoming =
    status === BookingStatus.DRAFT || status === BookingStatus.RESERVED;

  // Determine which date to use for calculation
  const targetDate = isUpcoming ? from : to;
  const remainingMs = targetDate.getTime() - currentDate.getTime();

  // Handle case where time has already passed
  if (remainingMs < 0) {
    // For OVERDUE status, show how long it's been overdue
    if (status === BookingStatus.OVERDUE) {
      const overdueMs = Math.abs(remainingMs);
      const overdueDays = Math.floor(overdueMs / ONE_DAY);
      const overdueHours = Math.floor((overdueMs % ONE_DAY) / ONE_HOUR);
      const overdueMinutes = Math.floor((overdueMs % ONE_HOUR) / (1000 * 60));

      return (
        <div className="flex items-center text-sm text-gray-600 md:ml-4 [&_span]:whitespace-nowrap">
          <Clock className="mr-1 size-4 text-gray-400" />
          <span className="font-medium text-gray-900">
            Overdue by {overdueDays} days
          </span>
          {overdueHours > 0 && (
            <>
              <span className="mx-1">·</span>
              <span>{overdueHours} hours</span>
            </>
          )}
          {overdueMinutes > 0 && (
            <>
              <span className="mx-1">·</span>
              <span>{overdueMinutes} minutes</span>
            </>
          )}
        </div>
      );
    }

    return null; // For other statuses where time has passed, don't show anything
  }

  // Calculate time units
  const remainingDays = Math.floor(remainingMs / ONE_DAY);
  const remainingHours = Math.floor((remainingMs % ONE_DAY) / ONE_HOUR);
  const remainingMinutes = Math.floor((remainingMs % ONE_HOUR) / (1000 * 60));

  // For upcoming bookings (DRAFT, RESERVED)
  if (isUpcoming) {
    return (
      <div className="flex items-center text-sm text-gray-600 md:ml-4 [&_span]:whitespace-nowrap">
        <Clock className="mr-1 size-4 text-gray-400" />
        <span className="font-medium text-gray-900">
          Starts in: {remainingDays} days
        </span>
        {remainingHours > 0 && (
          <>
            <span className="mx-1">·</span>
            <span>{remainingHours} hours</span>
          </>
        )}
        {remainingMinutes > 0 && (
          <>
            <span className="mx-1">·</span>
            <span>{remainingMinutes} minutes</span>
          </>
        )}
      </div>
    );
  }

  // For ONGOING status
  return (
    <div className="flex items-center text-sm text-gray-600 md:ml-4 [&_span]:whitespace-nowrap">
      <Clock className="mr-1 size-4 text-gray-400" />
      <span className="font-medium text-gray-900">{remainingDays} days</span>
      {remainingHours > 0 && (
        <>
          <span className="mx-1">·</span>
          <span>{remainingHours} hours</span>
        </>
      )}
      {remainingMinutes > 0 && (
        <>
          <span className="mx-1">·</span>
          <span>{remainingMinutes} minutes</span>
        </>
      )}
      <span className="ml-1">remaining</span>
    </div>
  );
}
