import { BookingStatus } from "@prisma/client";
import { useLoaderData, useSubmit } from "react-router";
import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { BookingOverviewPDF } from "./booking-overview-pdf";
import { CancelBookingDialog } from "./cancel-booking-dialog";
import { DeleteBooking } from "./delete-booking";

import ExtendBookingDialog from "./extend-booking-dialog";
import ManageNotificationsDialog from "./manage-notifications-dialog";
import RevertToDraftDialog from "./revert-to-draft-dialog";
import { Divider } from "../layout/divider";
import { Button } from "../shared/button";
import When from "../when/when";

interface Props {
  fullWidth?: boolean;
}

export const ActionsDropdown = ({ fullWidth }: Props) => {
  const { booking } = useLoaderData<typeof loader>();
  const {
    isCompleted,
    isOngoing,
    isReserved,
    isOverdue,
    isDraft,
    isArchived,
    isCancelled,
  } = useBookingStatusHelpers(booking.status);

  const submit = useSubmit();
  const { isBaseOrSelfService, roles } = useUserRoleHelper();

  const canArchiveBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.archive,
  });

  const canCancelBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.cancel,
  });

  const canExtendBooking =
    (isOngoing || isOverdue) &&
    userHasPermission({
      roles,
      entity: PermissionEntity.booking,
      action: PermissionAction.extend,
    });

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={tw("asset-actions grow", fullWidth ? "w-full" : "")}
      >
        <Button
          variant="secondary"
          data-test-id="bookingActionsButton"
          as="span"
          className="flex"
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev rotate-90" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          align="end"
          className="order w-[220px] rounded-md bg-white p-1.5 text-right"
        >
          <When truthy={booking.status === BookingStatus.RESERVED}>
            <RevertToDraftDialog booking={booking} />
          </When>
          <When
            truthy={(isOngoing || isReserved || isOverdue) && canCancelBooking}
          >
            <CancelBookingDialog bookingName={booking.name} />
          </When>
          <When truthy={canExtendBooking}>
            <ExtendBookingDialog
              currentEndDate={dateForDateTimeInputValue(new Date(booking.to))}
            />
          </When>
          <When truthy={isCompleted && canArchiveBooking}>
            <DropdownMenuItem asChild>
              <Button
                type="button"
                variant="link"
                className="justify-start text-gray-700 hover:cursor-pointer hover:text-gray-700"
                width="full"
                as="span"
                /**
                 * This button is rendered inside a Radix DropdownMenuPortal,
                 * which places it outside the parent Form in the DOM.
                 * We submit manually via onClick instead of relying on
                 * native form submission.
                 */
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "archive");
                  void submit(formData, { method: "post" });
                }}
              >
                Archive
              </Button>
            </DropdownMenuItem>
          </When>

          <DropdownMenuItem asChild>
            <Button
              variant="link"
              className="justify-start text-gray-700 hover:cursor-pointer hover:text-gray-700"
              width="full"
              to="duplicate"
            >
              Duplicate booking
            </Button>
          </DropdownMenuItem>

          <When
            truthy={
              !isBaseOrSelfService &&
              !isCompleted &&
              !isArchived &&
              !isCancelled
            }
          >
            <ManageNotificationsDialog />
          </When>

          {/* Because SELF_SERVICE and BASE can only delete bookings they own and are in draft, we need to handle it like this, rather than with userHasPermission */}

          <When
            truthy={(isBaseOrSelfService && isDraft) || !isBaseOrSelfService}
          >
            <DeleteBooking booking={booking} />
          </When>

          <Divider className="my-2" />
          <BookingOverviewPDF
            booking={booking}
            timeStamp={new Date().getTime()}
          />
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
};
