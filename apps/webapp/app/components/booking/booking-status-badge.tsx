import type { ReactNode } from "react";
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
  isPendingApproval = false,
}: {
  status: BookingStatus;
  /** Id of the custodian if it's a user */
  custodianUserId: string | undefined;
  /**
   * Derived server-side: the org requires approval and this RESERVED booking
   * has not been approved yet. Renders an extra "Pending approval" badge so
   * the state is visible wherever the status is.
   */
  isPendingApproval?: boolean;
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

  const colors = bookingStatusColorMap[status];
  return (
    <div className="flex items-center gap-1.5">
      <Badge color={colors.bg} textColor={colors.text} withDot={false}>
        {shouldShowExtraInfo ? (
          <ExtraInfoTooltip isPendingApproval={isPendingApproval}>
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
      {isPendingApproval ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge color="#B54708" withDot={false}>
                <span className="block whitespace-nowrap">
                  Pending approval
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72">
              <p>
                This booking request is waiting for an admin&apos;s approval.
                The items are held for the booking period, but they cannot be
                checked out until the request is approved.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}

function ExtraInfoTooltip({
  children,
  isPendingApproval,
}: {
  children: ReactNode;
  isPendingApproval?: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          <p>
            {isPendingApproval
              ? "Your booking request is waiting for an admin's approval. You will receive an email once it has been reviewed."
              : "Your booking is currently reserved, however the admin can choose to reject or close it at any point of time, if there are conflicts with other bookings."}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
