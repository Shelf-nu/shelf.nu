/**
 * The Quick actions column of one bookings-list row: compact icon buttons with
 * a tooltip each (the bookings twin of the assets index's `AssetQuickActions`),
 * followed by a ⋯ menu holding the rest of the booking page's Actions menu.
 *
 * The icons are check-out and check-in, so an operator can move a booking
 * along without opening it, the way the booking header does, with the same
 * dialogs and the same server action:
 *
 * | Status                                  | Buttons                              |
 * | --------------------------------------- | ------------------------------------ |
 * | RESERVED                                | Check out                            |
 * | ONGOING / OVERDUE, items still booked   | Check out remaining, Check in        |
 * | ONGOING / OVERDUE otherwise             | Check in                             |
 * | DRAFT / COMPLETE / CANCELLED / ARCHIVED | nothing                              |
 *
 * A button is hidden when the viewer lacks the grant for it, when the
 * workspace requires the explicit (scan or select) flow for the viewer's role
 * in that direction, or when the viewer neither writes every booking nor holds
 * this one. The rules live in {@link resolveBookingActions}; the server
 * refuses the one-click action in each case too. A RESERVED booking with reserved
 * model units no asset is assigned to yet keeps its Check out button
 * disabled: the booking page's fulfil scanner is where those are assigned.
 *
 * The ⋯ menu offers, each only when {@link resolveBookingActions} shows it:
 * extend, cancel, archive, duplicate, then (after a divider) the booking
 * document and the check-in receipt. It never offers revert to draft, delete
 * or manage notifications: those stay on the booking page. The PDFs list
 * assets in the server's default order, and the extend dialog fetches its own
 * reservation horizon when it opens. The receipt entry is shown disabled with
 * the rule's reason until something has been checked in. A row where the
 * viewer may do nothing renders nothing at all.
 *
 * Each row posts through its own fetcher form to the booking's overview
 * action, which owns the permission check, the explicit-mode guard, the asset
 * notes and the success toast. The form also says it comes from the list
 * (`origin`), so a check-out that would need a "From location" answer is
 * refused with a message instead of sending units out from a default nobody
 * chose. A refusal reaches the operator as the toast the action's error path
 * sends; the row has no space for an inline error and shows none.
 *
 * @see {@link file://./booking-actions.ts} decides which buttons show
 * @see {@link file://./booking-actions-menu.tsx} the ⋯ menu
 * @see {@link file://./actions-dropdown.tsx} the booking page's menu, which this mirrors
 * @see {@link file://./list-bookings-content.tsx} renders this in the Quick actions column
 * @see {@link file://./../assets/assets-index/asset-quick-actions.tsx} the assets index twin
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 * @see {@link file://./checkout-dialog.tsx} and {@link file://./checkin-dialog.tsx}
 */
import type { ReactNode } from "react";
import { ArrowRightFromLineIcon, LogInIcon, LogOutIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { ArchiveBookingAction } from "./archive-booking-action";
import { BookingActionTrigger } from "./booking-action-trigger";
import { useBookingActions } from "./booking-actions";
import type { BookingActionsBooking } from "./booking-actions";
import { BookingActionsMenu } from "./booking-actions-menu";
import { BookingDocumentEntries } from "./booking-document-entries";
import { CancelBookingDialog } from "./cancel-booking-dialog";
import CheckinDialog from "./checkin-dialog";
import CheckoutDialog from "./checkout-dialog";
import { DuplicateBookingAction } from "./duplicate-booking-action";
import ExtendBookingDialog from "./extend-booking-dialog";

/**
 * What the row buttons read off a bookings-list row: the rules' inputs
 * ({@link BookingActionsBooking}) plus what the dialogs and the form need.
 */
export type BookingQuickActionsBooking = BookingActionsBooking & {
  id: string;
  name: string;
  from: Date | string | null;
};

/** Props for {@link BookingQuickActions}. */
type BookingQuickActionsProps = {
  booking: BookingQuickActionsBooking;
};

/** Each action's tooltip and accessible name, and its icon. */
const ACTIONS = {
  checkOut: { label: "Check out", icon: <LogOutIcon className="size-4" /> },
  checkOutRemaining: {
    label: "Check out remaining",
    icon: <ArrowRightFromLineIcon className="size-4" />,
  },
  checkIn: { label: "Check in", icon: <LogInIcon className="size-4" /> },
} satisfies Record<string, { label: string; icon: ReactNode }>;

/** Why a row's icon buttons are disabled while its request runs. */
const BUSY_REASON = "Updating this booking...";

/**
 * Stands in for an action's dialog trigger while the row's request runs: the
 * same icon trigger, disabled, so the cell keeps its shape and one click
 * cannot post twice.
 *
 * @param props.label - The action's accessible name and tooltip
 * @param props.icon - The action's icon
 */
function BusyActionButton({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <BookingActionTrigger
      variant="icon"
      label={label}
      icon={icon}
      disabled={{ reason: BUSY_REASON }}
    />
  );
}

/**
 * Renders the row's action buttons, or nothing when the booking's status or
 * the viewer's reach offers none.
 *
 * @param props.booking - The row, see {@link BookingQuickActionsBooking}
 */
export function BookingQuickActions({ booking }: BookingQuickActionsProps) {
  const actions = useBookingActions(booking);

  const fetcher = useFetcher<DataOrErrorResponse>();
  const formId = `booking-row-check-in-out-${booking.id}`;
  /**
   * While the action runs, the dialogs are unmounted (which closes them) and
   * disabled buttons stand in their place, so one click cannot post twice and
   * a refusal shows on the page rather than behind the dialog.
   */
  const busy = useDisabled(fetcher);

  const {
    checkOut,
    checkOutRemaining,
    checkIn,
    extend,
    cancel,
    archive,
    discardDraft,
    duplicate,
    bookingDocument,
    checkinReceipt,
  } = actions;
  const hasMenuEntries =
    extend.visible ||
    cancel.visible ||
    archive.visible ||
    discardDraft.visible ||
    duplicate.visible ||
    bookingDocument.visible ||
    checkinReceipt.visible;
  if (
    !checkOut.visible &&
    !checkOutRemaining.visible &&
    !checkIn.visible &&
    !hasMenuEntries
  ) {
    return null;
  }

  const dialogBooking = {
    id: booking.id,
    name: booking.name,
    // `status` and `to` let the check-out dialog spot an expired reservation
    // and ask how to check it out; without them the server refuses it.
    status: booking.status,
    from: new Date(booking.from ?? Date.now()),
    to: new Date(booking.to ?? Date.now()),
  };

  return (
    <>
      {/* Outside the flex row and not displayed: an empty form is still a
          flex item, and the gap would put space before the first button.
          The buttons reach it through `form={formId}`. */}
      <fetcher.Form
        id={formId}
        className="hidden"
        method="post"
        action={`/bookings/${booking.id}/overview`}
      >
        {/* Marks the post as coming from the list, see the module JSDoc. */}
        <input type="hidden" name="origin" value="bookings-list" />
        {/* "Check out remaining" answers with JSON instead of redirecting to
            the booking, so the list stays where the operator is. */}
        <input type="hidden" name="returnJson" value="true" />
      </fetcher.Form>

      <div className="flex items-center justify-end gap-2">
        {checkOut.visible ? (
          busy ? (
            <BusyActionButton {...ACTIONS.checkOut} />
          ) : (
            <CheckoutDialog
              booking={dialogBooking}
              formId={formId}
              intent="checkOut"
              variant="icon"
              {...ACTIONS.checkOut}
              disabled={checkOut.disabled}
            />
          )
        ) : null}

        {checkOutRemaining.visible ? (
          busy ? (
            <BusyActionButton {...ACTIONS.checkOutRemaining} />
          ) : (
            <CheckoutDialog
              booking={dialogBooking}
              formId={formId}
              intent="checkOutRemaining"
              variant="icon"
              {...ACTIONS.checkOutRemaining}
              // The booking has started: adjusting the start date no longer
              // applies, the same as the header's "Check out remaining".
              suppressEarlyCheckoutPrompt
            />
          )
        ) : null}

        {checkIn.visible ? (
          busy ? (
            <BusyActionButton {...ACTIONS.checkIn} />
          ) : (
            <CheckinDialog
              booking={dialogBooking}
              formId={formId}
              variant="icon"
              {...ACTIONS.checkIn}
            />
          )
        ) : null}

        {/* No row-level click handler needs guarding: the list row navigates
            through its links and bulk selection is its own checkbox. */}
        {hasMenuEntries ? (
          <BookingActionsMenu trigger="icon">
            {extend.visible ? (
              <ExtendBookingDialog
                booking={{
                  id: booking.id,
                  from: dialogBooking.from,
                  to: dialogBooking.to,
                }}
              />
            ) : null}
            {cancel.visible ? (
              <CancelBookingDialog
                booking={{ id: booking.id, name: booking.name }}
              />
            ) : null}
            {archive.visible ? (
              <ArchiveBookingAction booking={{ id: booking.id }} />
            ) : null}
            {discardDraft.visible ? (
              <ArchiveBookingAction booking={{ id: booking.id }} discardDraft />
            ) : null}
            {duplicate.visible ? (
              <DuplicateBookingAction booking={{ id: booking.id }} />
            ) : null}
            <BookingDocumentEntries
              booking={{ id: booking.id, name: booking.name }}
              actions={{ bookingDocument, checkinReceipt }}
            />
          </BookingActionsMenu>
        ) : null}
      </div>
    </>
  );
}
