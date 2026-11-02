import { BookingStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { useSearchParams } from "~/hooks/search-params";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useRoleAccess } from "~/hooks/use-role-access";
import { isBookingArchivable } from "~/modules/booking/helpers";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { ArchiveBookingAction } from "./archive-booking-action";
import {
  BookingCheckinReceiptPDF,
  checkinReceiptUnavailableReason,
  isCheckinReceiptAvailable,
} from "./booking-checkin-receipt-pdf";
import {
  BookingOverviewPDF,
  pdfAssetOrderFromSearchParams,
} from "./booking-overview-pdf";
import { CancelBookingDialog } from "./cancel-booking-dialog";
import { DeleteBooking } from "./delete-booking";
import { DuplicateBookingAction } from "./duplicate-booking-action";

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
  const { booking, hasDispositionedUnits, nextReservations } =
    useLoaderData<typeof loader>();
  const {
    isCompleted,
    isOngoing,
    isReserved,
    isOverdue,
    isDraft,
    isArchived,
    isCancelled,
  } = useBookingStatusHelpers(booking.status);

  const roles = useOrganizationRoles();
  const roleAccess = useRoleAccess();
  // The PDFs list assets in the order the page is showing them.
  const [searchParams] = useSearchParams();
  const assetOrder = pdfAssetOrderFromSearchParams(searchParams);

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
            <CancelBookingDialog booking={booking} />
          </When>
          <When truthy={canExtendBooking}>
            <ExtendBookingDialog
              booking={booking}
              nextReservations={nextReservations}
            />
          </When>
          <When
            truthy={
              isBookingArchivable({ status: booking.status, to: booking.to }) &&
              canArchiveBooking
            }
          >
            <DropdownMenuItem asChild>
              <ArchiveBookingAction booking={{ id: booking.id }} />
            </DropdownMenuItem>
          </When>

          <DropdownMenuItem asChild>
            <DuplicateBookingAction booking={{ id: booking.id }} />
          </DropdownMenuItem>

          <When
            truthy={
              roleAccess.policy.notifications.manageBookingRecipients &&
              !isCompleted &&
              !isArchived &&
              !isCancelled
            }
          >
            <ManageNotificationsDialog />
          </When>

          {/* Members whose policy limits delete to drafts see Delete only on a
              draft; the server applies the same rule (`assertCanDeleteBooking`). */}
          <When
            truthy={!roleAccess.policy.bookings.deleteOnlyDrafts || isDraft}
          >
            <DeleteBooking booking={booking} />
          </When>

          <Divider className="my-2" />
          <BookingOverviewPDF
            booking={{
              id: booking.id,
              name: booking.name,
              assetCount: booking.bookingAssets.length,
            }}
            assetOrder={assetOrder}
          />
          <BookingCheckinReceiptPDF
            booking={booking}
            available={isCheckinReceiptAvailable({
              status: booking.status,
              bookingAssets: booking.bookingAssets,
              hasDispositionedUnits,
            })}
            unavailableReason={checkinReceiptUnavailableReason(
              booking.bookingAssets
            )}
            assetOrder={assetOrder}
            timeStamp={new Date().getTime()}
          />
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
};
