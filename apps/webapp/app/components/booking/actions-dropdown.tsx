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
import { ArchiveBookingAction } from "./archive-booking-action";
import { useBookingActions } from "./booking-actions";
import { BookingActionsMenu } from "./booking-actions-menu";
import { checkinReceiptUnavailableReason } from "./booking-checkin-receipt-pdf";
import { BookingDocumentEntries } from "./booking-document-entries";
import { pdfAssetOrderFromSearchParams } from "./booking-overview-pdf";
import { CancelBookingDialog } from "./cancel-booking-dialog";
import { DeleteBooking } from "./delete-booking";
import { DuplicateBookingAction } from "./duplicate-booking-action";
import ExtendBookingDialog from "./extend-booking-dialog";
import ManageNotificationsDialog from "./manage-notifications-dialog";
import RevertToDraftDialog from "./revert-to-draft-dialog";

/**
 * Renders the booking page's Actions menu, in this order: revert to draft,
 * cancel, extend, archive, discard draft, duplicate, manage notifications,
 * delete, a divider,
 * the booking document and the check-in receipt.
 */
export const ActionsDropdown = () => {
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
    // `grow` on the trigger itself: the header row stretches it on mobile.
    <BookingActionsMenu trigger="button" triggerClassName="grow">
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
      {actions.discardDraft.visible ? (
        <ArchiveBookingAction booking={{ id: booking.id }} discardDraft />
      ) : null}
      {actions.duplicate.visible ? (
        <DuplicateBookingAction booking={{ id: booking.id }} />
      ) : null}
      {actions.manageNotifications.visible ? (
        <ManageNotificationsDialog />
      ) : null}
      {actions.delete.visible ? <DeleteBooking booking={booking} /> : null}

      <BookingDocumentEntries
        booking={{ id: booking.id, name: booking.name }}
        actions={actions}
        assetOrder={assetOrder}
      />
    </BookingActionsMenu>
  );
};
