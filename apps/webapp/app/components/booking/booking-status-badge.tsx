import type { ReactNode } from "react";
import { BookingStatus } from "@prisma/client";
import { useRerenderAt } from "~/hooks/use-rerender-at";
import { useReservationIsRequest } from "~/hooks/use-reservation-is-request";
import { useUserData } from "~/hooks/use-user-data";
import { isReservationExpired } from "~/modules/booking/helpers";
import { BADGE_COLORS } from "~/utils/badge-colors";
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
  to,
}: {
  status: BookingStatus;
  /** Id of the custodian if it's a user */
  custodianUserId: string | undefined;
  /**
   * The booking's end date. With it, a RESERVED booking whose end has passed
   * reads "Expired" in gray instead of "Reserved" in blue: the stored status
   * is unchanged, the chip just stops promising a pickup that never came (see
   * `isReservationExpired`). Call sites that must show the stored status
   * verbatim, such as activity notes, leave it out.
   */
  to?: Date | string | null;
}) {
  const reservationIsRequest = useReservationIsRequest();
  const user = useUserData();
  // The Expired label reads the clock, so a page left open re-renders at the
  // reservation's end. Past, missing or non-RESERVED dates schedule nothing.
  useRerenderAt(status === BookingStatus.RESERVED && to ? new Date(to) : null);

  /**
   * This is used to show the extra info tooltip when the booking is
   * reserved and the user is the custodian of the booking.
   * Shown to members whose reservations are requests (they cannot check out).
   */
  const isExpired = isReservationExpired(status, to);
  const shouldShowExtraInfo =
    reservationIsRequest &&
    status === BookingStatus.RESERVED &&
    // A dead request is not under review any more.
    !isExpired &&
    custodianUserId &&
    custodianUserId === user?.id;

  const colors = isExpired ? BADGE_COLORS.gray : bookingStatusColorMap[status];
  const label = isExpired ? "EXPIRED" : status;
  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
      {shouldShowExtraInfo ? (
        <ExtraInfoTooltip>
          <span className="block whitespace-nowrap lowercase first-letter:uppercase">
            {label} - subject to review
          </span>
        </ExtraInfoTooltip>
      ) : (
        <span className="block whitespace-nowrap lowercase first-letter:uppercase">
          {label}
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
            Your booking is currently reserved, however an administrator or
            manager can choose to reject or close it at any point of time, if
            there are conflicts with other bookings.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
