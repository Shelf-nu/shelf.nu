/**
 * The document tail of a booking's actions menu: a divider, then the booking
 * document and the check-in receipt entries, each only when the shared rules
 * show it.
 *
 * Both menus that offer the documents (the booking page's Actions menu and a
 * bookings list row's menu) render this one component, so the entries, their
 * order and their disabled states cannot differ between the two.
 *
 * @see {@link file://./booking-actions.ts} decides visibility and disabled state
 * @see {@link file://./actions-dropdown.tsx} the booking page's menu
 * @see {@link file://./booking-quick-actions.tsx} a list row's menu
 */
import type { Booking } from "@prisma/client";
import type { BookingActions } from "./booking-actions";
import { BookingCheckinReceiptPDF } from "./booking-checkin-receipt-pdf";
import { BookingOverviewPDF } from "./booking-overview-pdf";
import type { PdfAssetOrder } from "./booking-overview-pdf";
import { Divider } from "../layout/divider";

/** Props for {@link BookingDocumentEntries}. */
type BookingDocumentEntriesProps = {
  /** The booking both documents print. */
  booking: { id: Booking["id"]; name: Booking["name"] };
  /** The two document entries' states, from `resolveBookingActions`. */
  actions: Pick<BookingActions, "bookingDocument" | "checkinReceipt">;
  /**
   * The sort both documents list assets in. Omitted, the server default
   * applies; the booking page passes the sort of its own URL.
   */
  assetOrder?: PdfAssetOrder;
};

/**
 * Renders the divider and the visible document entries, or nothing when
 * neither entry is offered.
 *
 * @param props - See {@link BookingDocumentEntriesProps}
 */
export function BookingDocumentEntries({
  booking,
  actions,
  assetOrder,
}: BookingDocumentEntriesProps) {
  const { bookingDocument, checkinReceipt } = actions;
  if (!bookingDocument.visible && !checkinReceipt.visible) return null;

  return (
    <>
      <Divider className="my-2" />
      {bookingDocument.visible ? (
        <BookingOverviewPDF
          booking={booking}
          disabled={bookingDocument.disabled}
          assetOrder={assetOrder}
        />
      ) : null}
      {checkinReceipt.visible ? (
        <BookingCheckinReceiptPDF
          booking={booking}
          disabled={checkinReceipt.disabled}
          assetOrder={assetOrder}
        />
      ) : null}
    </>
  );
}
