import type { ReactNode } from "react";
import { BookingStatus } from "@prisma/client";
import { useReservationIsRequest } from "~/hooks/use-reservation-is-request";
import { useUserData } from "~/hooks/use-user-data";
import { bookingStatusColorMap } from "~/utils/bookings";
import { Badge } from "../shared/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/**
 * A booking's status badge. On a reserved booking the member holds, it adds a
 * "subject to review" tooltip when that member's reservations are requests.
 */
export function BookingStatusBadge({
  status,
  custodianUserId,
}: {
  status: BookingStatus;
  /** Id of the custodian if it's a user */
  custodianUserId: string | undefined;
}) {
  const reservationIsRequest = useReservationIsRequest();
  const user = useUserData();

  /**
   * This is used to show the extra info tooltip when the booking is
   * reserved and the user is the custodian of the booking.
   * Shown to members whose reservations are requests (they cannot check out).
   */
  const shouldShowExtraInfo =
    reservationIsRequest &&
    status === BookingStatus.RESERVED &&
    custodianUserId &&
    custodianUserId === user?.id;

  const colors = bookingStatusColorMap[status];
  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
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

function ExtraInfoTooltip({ children }: { children: ReactNode }) {
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
