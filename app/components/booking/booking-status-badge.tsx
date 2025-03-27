import { BookingStatus } from "@prisma/client";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { bookingStatusColorMap } from "~/utils/bookings";
import { Badge } from "../shared/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { isBase } = useUserRoleHelper();
  const shouldShowExtraInfo = isBase && status === BookingStatus.RESERVED;

  return (
    <Badge color={bookingStatusColorMap[status]}>
      {shouldShowExtraInfo ? (
        <ExtraInfoTooltip>
          <span className="block whitespace-nowrap lowercase first-letter:uppercase">
            {status} - subject to review
          </span>
        </ExtraInfoTooltip>
      ) : (
        <span className="block whitespace-nowrap lowercase first-letter:uppercase">
          {status}
        </span>
      )}
    </Badge>
  );
}

function ExtraInfoTooltip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          <p>
            Your booking is currently reserved, however the admin can choose to
            reject or close it at any point of time, if there are conflicts with
            other bookings.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
