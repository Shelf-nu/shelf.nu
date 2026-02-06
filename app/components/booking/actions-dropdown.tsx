import { BookingStatus, OrganizationRoles } from "@prisma/client";
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
import { RejectBookingDialog } from "./reject-booking-dialog";
import RevertToDraftDialog from "./revert-to-draft-dialog";
import { Divider } from "../layout/divider";
import { Button } from "../shared/button";
import When from "../when/when";

interface Props {
  fullWidth?: boolean;
}

export const ActionsDropdown = ({ fullWidth }: Props) => {
  const { booking } = useLoaderData<typeof loader>();
  const { isCompleted, isOngoing, isReserved, isApproved, isOverdue, isDraft } =
    useBookingStatusHelpers(booking.status);

  const submit = useSubmit();
  const { isBaseOrSelfService, isAdministratorOrOwner, roles } =
    useUserRoleHelper();

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

  /**
   * Check if this booking was created by a BASE user.
   * Approve/Reject actions are only shown for BASE user bookings.
   */
  const creatorRoles = (
    booking.creator as {
      userOrganizations?: Array<{ roles: OrganizationRoles[] }>;
    }
  )?.userOrganizations;
  const isBaseUserBooking =
    creatorRoles &&
    creatorRoles.length > 0 &&
    creatorRoles[0].roles.includes(OrganizationRoles.BASE);

  /** Admin/Owner can approve/reject RESERVED bookings created by BASE users */
  const canApproveOrReject =
    isAdministratorOrOwner && isReserved && isBaseUserBooking;

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
          <When truthy={canApproveOrReject}>
            <DropdownMenuItem asChild>
              <Button
                variant="link"
                className="justify-start font-medium text-success-600 hover:cursor-pointer hover:text-success-700"
                width="full"
                as="span"
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "approve");
                  void submit(formData, { method: "post" });
                }}
              >
                Approve
              </Button>
            </DropdownMenuItem>
            <RejectBookingDialog bookingName={booking.name} />
          </When>

          <When
            truthy={
              booking.status === BookingStatus.RESERVED ||
              booking.status === BookingStatus.APPROVED
            }
          >
            <RevertToDraftDialog booking={booking} />
          </When>
          <When
            truthy={
              (isOngoing || isReserved || isApproved || isOverdue) &&
              canCancelBooking
            }
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
                variant="link"
                className="justify-start text-gray-700 hover:cursor-pointer hover:text-gray-700"
                width="full"
                name="intent"
                value="archive"
                as="span"
                /**
                 * Here we have to deal with a interesting case that is in a way a conflict between how react works and web platform
                 * So this button within the react code, is inside a form that is in the parent component, however because its a radix dropdown, it gets rendered within a portal
                 * So the button is actually rendered outside the form, and when you click on it, it does not submit the form
                 * So we have to manually submit the data here.
                 *
                 * Keep in mind that even though its rendered in the DOM within a portal, react will still detect it as being inside the form, so there could be some hydration errors
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
