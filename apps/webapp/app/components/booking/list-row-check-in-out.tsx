/**
 * Check-out and check-in buttons for one row of the bookings list.
 *
 * Lets an operator move a booking along without opening it, the way the
 * booking header does, with the same dialogs and the same server action:
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
 * in that direction, or when the viewer may not write this booking at all (a
 * member held to their own bookings, on someone else's), since the server
 * refuses the one-click action in each case. A RESERVED booking with reserved
 * model units no asset is assigned to yet keeps its Check out button
 * disabled: the booking page's fulfil scanner is where those are assigned.
 *
 * Each row posts through its own fetcher form to the booking's overview
 * action, which owns the permission check, the explicit-mode guard, the asset
 * notes and the success toast. The form also says it comes from the list
 * (`origin`), so a check-out that would need a "From location" answer is
 * refused with a message instead of sending units out from a default nobody
 * chose. A refusal reaches the operator as the toast the action's error path
 * sends; the row has no space for an inline error and shows none.
 *
 * @see {@link file://./list-bookings-content.tsx} renders this in the last column
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 * @see {@link file://./checkout-dialog.tsx} and {@link file://./checkin-dialog.tsx}
 */
import { BookingStatus } from "@prisma/client";
import { useFetcher } from "react-router";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useDisabled } from "~/hooks/use-disabled";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useRoleAccess } from "~/hooks/use-role-access";
import { useUserData } from "~/hooks/use-user-data";
import type { CountableModelRequest } from "~/utils/booking-model-requests";
import { countUnassignedModelUnits } from "~/utils/booking-model-requests";
import type { DataOrErrorResponse } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { isExplicitScanRequired } from "~/utils/permissions/role-access";
import CheckinDialog from "./checkin-dialog";
import CheckoutDialog from "./checkout-dialog";
import { Button } from "../shared/button";

/** What the row buttons read off a bookings-list row. */
export type ListRowCheckInOutBooking = {
  id: string;
  name: string;
  status: BookingStatus;
  from: Date | string | null;
  to: Date | string | null;
  /** Who created the booking and who holds it: the two ways to own it. */
  creatorId: string;
  custodianUserId: string | null;
  /** Reserved model units, to disable Check out while some are unassigned. */
  modelRequests: CountableModelRequest[];
  /**
   * Whether a slice of this booking is still in the Booked bucket, as the
   * list loader resolved it. Decides "Check out remaining" on a booking that
   * is underway. Absent on a loader that does not resolve it, which reads as
   * "nothing left to check out".
   */
  hasItemsToCheckOut?: boolean;
};

/** Props for {@link ListRowCheckInOut}. */
type ListRowCheckInOutProps = {
  booking: ListRowCheckInOutBooking;
};

/** Why a RESERVED booking's Check out is disabled while model units are unassigned. */
export const ASSIGN_UNITS_FIRST_REASON =
  "Open the booking to assign the reserved units first.";

/** Compact trigger styling: the row has no room for a stretched button. */
const TRIGGER_CLASS = "whitespace-nowrap";

/**
 * Decides which buttons a row offers, from the booking and the viewer.
 *
 * Pure, so the table above is pinned by a test; the component only renders
 * what this returns.
 *
 * @param args.booking - The row
 * @param args.canCheckOut - The viewer holds `booking:checkout` and is not held to explicit check-out
 * @param args.canCheckIn - The viewer holds `booking:checkin` and is not held to explicit check-in
 * @returns Which of the three buttons to render
 */
export function resolveRowCheckInOut({
  booking,
  canCheckOut,
  canCheckIn,
}: {
  booking: Pick<ListRowCheckInOutBooking, "status" | "hasItemsToCheckOut">;
  canCheckOut: boolean;
  canCheckIn: boolean;
}): { checkOut: boolean; checkOutRemaining: boolean; checkIn: boolean } {
  const isReserved = booking.status === BookingStatus.RESERVED;
  const isUnderway =
    booking.status === BookingStatus.ONGOING ||
    booking.status === BookingStatus.OVERDUE;

  return {
    checkOut: isReserved && canCheckOut,
    checkOutRemaining:
      isUnderway && canCheckOut && booking.hasItemsToCheckOut === true,
    checkIn: isUnderway && canCheckIn,
  };
}

/**
 * Renders the row's check-out and check-in buttons, or nothing when the
 * booking's status or the viewer's reach offers none.
 *
 * @param props.booking - The row, see {@link ListRowCheckInOutBooking}
 */
export function ListRowCheckInOut({ booking }: ListRowCheckInOutProps) {
  const roles = useOrganizationRoles();
  const roleAccess = useRoleAccess();
  const bookingSettings = useBookingSettings();
  const userId = useUserData()?.id;

  const fetcher = useFetcher<DataOrErrorResponse>();
  const formId = `booking-row-check-in-out-${booking.id}`;
  /**
   * While the action runs, the dialogs are unmounted (which closes them) and
   * disabled buttons stand in their place, so one click cannot post twice and
   * a refusal shows on the page rather than behind the dialog.
   */
  const busy = useDisabled(fetcher);

  /**
   * Whether the viewer may write this booking: everyone who writes every
   * booking, otherwise its creator or its custodian. The same rule the
   * action's `validateBookingOwnership` guard applies (`canWriteBooking` in
   * `~/utils/booking-authorization.server`), mirrored here because that module
   * is server-only; the server still decides.
   */
  const canWriteThisBooking =
    roleAccess.bookings.writeAll ||
    (userId !== undefined &&
      (booking.creatorId === userId || booking.custodianUserId === userId));
  if (!canWriteThisBooking) {
    return null;
  }

  const canCheckOut =
    userHasPermission({
      roles,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkout,
    }) &&
    !isExplicitScanRequired({
      access: roleAccess,
      settings: bookingSettings,
      direction: "checkout",
    });
  const canCheckIn =
    userHasPermission({
      roles,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkin,
    }) &&
    !isExplicitScanRequired({
      access: roleAccess,
      settings: bookingSettings,
      direction: "checkin",
    });

  const buttons = resolveRowCheckInOut({ booking, canCheckOut, canCheckIn });
  if (!buttons.checkOut && !buttons.checkOutRemaining && !buttons.checkIn) {
    return null;
  }

  const unassignedUnits = countUnassignedModelUnits(booking.modelRequests);
  const checkOutDisabled =
    unassignedUnits > 0 ? { reason: ASSIGN_UNITS_FIRST_REASON } : false;

  const dialogBooking = {
    id: booking.id,
    name: booking.name,
    from: new Date(booking.from ?? Date.now()),
    to: new Date(booking.to ?? Date.now()),
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <fetcher.Form
        id={formId}
        method="post"
        action={`/bookings/${booking.id}/overview`}
      >
        {/* Marks the post as coming from the list, see the module JSDoc. */}
        <input type="hidden" name="origin" value="bookings-list" />
        {/* "Check out remaining" answers with JSON instead of redirecting to
            the booking, so the list stays where the operator is. */}
        <input type="hidden" name="returnJson" value="true" />
      </fetcher.Form>

      {buttons.checkOut ? (
        busy ? (
          <Button type="button" size="sm" disabled className={TRIGGER_CLASS}>
            Check out
          </Button>
        ) : (
          <CheckoutDialog
            booking={dialogBooking}
            formId={formId}
            intent="checkOut"
            label="Check out"
            disabled={checkOutDisabled}
            triggerClassName={TRIGGER_CLASS}
          />
        )
      ) : null}

      {buttons.checkOutRemaining ? (
        busy ? (
          <Button type="button" size="sm" disabled className={TRIGGER_CLASS}>
            Check out remaining
          </Button>
        ) : (
          <CheckoutDialog
            booking={dialogBooking}
            formId={formId}
            intent="checkOutRemaining"
            label="Check out remaining"
            // The booking has started: adjusting the start date no longer
            // applies, the same as the header's "Check out remaining".
            suppressEarlyCheckoutPrompt
            triggerClassName={TRIGGER_CLASS}
          />
        )
      ) : null}

      {buttons.checkIn ? (
        busy ? (
          <Button type="button" size="sm" disabled className={TRIGGER_CLASS}>
            Check in
          </Button>
        ) : (
          <CheckinDialog
            booking={dialogBooking}
            formId={formId}
            label="Check in"
          />
        )
      ) : null}
    </div>
  );
}
