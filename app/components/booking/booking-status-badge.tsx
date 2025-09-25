import { BookingStatus } from "@prisma/client";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { bookingStatusColorMap } from "~/utils/bookings";
import { Badge } from "../shared/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export function BookingStatusBadge({
  status,
  custodianUserId,
}: {
  status: BookingStatus;
  /** Id of the custodian if it's a user */
  custodianUserId: string | undefined;
}) {
  const { isBase } = useUserRoleHelper();
  const user = useUserData();

  /**
   * This is used to show the extra info tooltip when the booking is
   * reserved and the user is the custodian of the booking.
   * This is only shown for base users.
   */
  const shouldShowExtraInfo =
    isBase &&
    status === BookingStatus.RESERVED &&
    custodianUserId &&
    custodianUserId === user?.id;

  return (
    <Badge color={bookingStatusColorMap[status]} withDot={false}>
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
