/**
 * The booking page's "Actions" menu.
 *
 * Which entries show comes from the shared rules (`useBookingActions`), the
 * same ones the bookings list row reads, so the two surfaces cannot disagree.
 * The page renders this menu only for viewers who may act on the booking
 * (`canSeeActions` in `forms/edit-booking-form.tsx`).
 *
 * @see {@link file://./booking-actions-menu.tsx} the menu itself
 * @see {@link file://./booking-actions.ts} the rules
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the loader and actions
 */
import { useLoaderData } from "react-router";
import { useSearchParams } from "~/hooks/search-params";
import { isCheckinReceiptAvailable } from "~/modules/booking/checkin-receipt-availability";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.overview";
import { tw } from "~/utils/tw";
import { ArchiveBookingAction } from "./archive-booking-action";
import { useBookingActions } from "./booking-actions";
import { BookingActionsMenu } from "./booking-actions-menu";
import {
  BookingCheckinReceiptPDF,
  checkinReceiptUnavailableReason,
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

/** Props for {@link ActionsDropdown}. */
interface Props {
  /** Stretches the trigger's wrapper to the full width of its container. */
  fullWidth?: boolean;
}

/**
 * Renders the booking page's Actions menu, in this order: revert to draft,
 * cancel, extend, archive, duplicate, manage notifications, delete, a divider,
 * the booking document and the check-in receipt.
 *
 * @param props - See {@link Props}
 */
export const ActionsDropdown = ({ fullWidth }: Props) => {
  const { booking, hasDispositionedUnits, nextReservations } =
    useLoaderData<typeof loader>();

  // The PDFs list assets in the order the page is showing them.
  const [searchParams] = useSearchParams();
  const assetOrder = pdfAssetOrderFromSearchParams(searchParams);

  const canPrintCheckinReceipt = isCheckinReceiptAvailable({
    status: booking.status,
    bookingAssets: booking.bookingAssets,
    hasDispositionedUnits,
  });

  // The page names what is missing; the list row shows the rule's generic text.
  const unavailableReason = checkinReceiptUnavailableReason(
    booking.bookingAssets
  );

  const actions = useBookingActions({
    status: booking.status,
    to: booking.to,
    custodianUserId: booking.custodianUserId,
    custodianTeamMemberUserId: booking.custodianTeamMember?.userId ?? null,
    assetCount: booking.bookingAssets.length,
    modelRequests: booking.modelRequests ?? [],
    canPrintCheckinReceipt,
    checkinReceiptUnavailableReason: unavailableReason,
  });

  return (
    <div className={tw("grow", fullWidth ? "w-full" : "")}>
      <BookingActionsMenu trigger="button">
        {actions.revertToDraft.visible ? (
          <RevertToDraftDialog booking={booking} />
        ) : null}
        {actions.cancel.visible ? (
          <CancelBookingDialog booking={booking} />
        ) : null}
        {actions.extend.visible ? (
          <ExtendBookingDialog
            booking={booking}
            nextReservations={nextReservations}
          />
        ) : null}
        {actions.archive.visible ? (
          <ArchiveBookingAction booking={{ id: booking.id }} />
        ) : null}
        {actions.duplicate.visible ? (
          <DuplicateBookingAction booking={{ id: booking.id }} />
        ) : null}
        {actions.manageNotifications.visible ? (
          <ManageNotificationsDialog />
        ) : null}
        {/* Members whose policy limits delete to drafts see Delete only on a
            draft; the server applies the same rule (`assertCanDeleteBooking`). */}
        {actions.delete.visible ? <DeleteBooking booking={booking} /> : null}

        {actions.bookingDocument.visible || actions.checkinReceipt.visible ? (
          <Divider className="my-2" />
        ) : null}
        {actions.bookingDocument.visible ? (
          <BookingOverviewPDF
            booking={{
              id: booking.id,
              name: booking.name,
              assetCount: booking.bookingAssets.length,
            }}
            assetOrder={assetOrder}
          />
        ) : null}
        {actions.checkinReceipt.visible ? (
          <BookingCheckinReceiptPDF
            booking={booking}
            available={canPrintCheckinReceipt}
            unavailableReason={unavailableReason}
            assetOrder={assetOrder}
            timeStamp={new Date().getTime()}
          />
        ) : null}
      </BookingActionsMenu>
    </div>
  );
};
