/**
 * The Actions column of one bookings-list row: compact icon buttons with a
 * tooltip each, the bookings twin of the assets index's `AssetQuickActions`.
 * New row actions belong here, in the same icon-button shape.
 *
 * Today it holds check-out and check-in, so an operator can move a booking
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
 * @see {@link file://./list-bookings-content.tsx} renders this in the Actions column
 * @see {@link file://./../assets/assets-index/asset-quick-actions.tsx} the assets index twin
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 * @see {@link file://./checkout-dialog.tsx} and {@link file://./checkin-dialog.tsx}
 */
import type { ReactNode } from "react";
import { BookingStatus } from "@prisma/client";
import { ArrowRightFromLineIcon, LogInIcon, LogOutIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useDisabled } from "~/hooks/use-disabled";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useRoleAccess } from "~/hooks/use-role-access";
import { useUserData } from "~/hooks/use-user-data";
import type { CountableModelRequest } from "~/utils/booking-model-requests";
import { countUnassignedModelUnits } from "~/utils/booking-model-requests";
import { canWriteBooking } from "~/utils/bookings";
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
export type BookingQuickActionsBooking = {
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
   * Whether the booking's "Check out remaining" would find something to send,
   * as the list loader resolved it by the server's own rule. Decides "Check out remaining" on a booking that is
   * underway. Absent on a loader that does not resolve it, which reads as
   * "nothing left to check out".
   */
  hasItemsToCheckOut?: boolean;
};

/** Props for {@link BookingQuickActions}. */
type BookingQuickActionsProps = {
  booking: BookingQuickActionsBooking;
};

/** Why a RESERVED booking's Check out is disabled while model units are unassigned. */
export const ASSIGN_UNITS_FIRST_REASON =
  "Open the booking to assign the reserved units first.";

/** The heading of that reason's hover card, naming the blocked action. */
const CHECK_OUT_BLOCKED_TITLE = "Can't check out yet";

/** Each action's tooltip and accessible name, and its icon. */
const ACTIONS = {
  checkOut: { label: "Check out", icon: <LogOutIcon className="size-4" /> },
  checkOutRemaining: {
    label: "Check out remaining",
    icon: <ArrowRightFromLineIcon className="size-4" />,
  },
  checkIn: { label: "Check in", icon: <LogInIcon className="size-4" /> },
} satisfies Record<string, { label: string; icon: ReactNode }>;

/**
 * Stands in for an action's dialog trigger while the row's request runs: the
 * same icon button, disabled, so the cell keeps its shape and one click
 * cannot post twice.
 */
function BusyActionButton({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="p-2"
      aria-label={label}
      disabled
    >
      {icon}
    </Button>
  );
}

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
export function resolveCheckInOutActions({
  booking,
  canCheckOut,
  canCheckIn,
}: {
  booking: Pick<BookingQuickActionsBooking, "status" | "hasItemsToCheckOut">;
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
 * Renders the row's action buttons, or nothing when the booking's status or
 * the viewer's reach offers none.
 *
 * @param props.booking - The row, see {@link BookingQuickActionsBooking}
 */
export function BookingQuickActions({ booking }: BookingQuickActionsProps) {
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

  // The same rule the action's `validateBookingOwnership` guard applies; the
  // server still decides.
  const canWriteThisBooking =
    userId !== undefined &&
    canWriteBooking({ booking, userId, access: roleAccess });
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

  const buttons = resolveCheckInOutActions({
    booking,
    canCheckOut,
    canCheckIn,
  });
  if (!buttons.checkOut && !buttons.checkOutRemaining && !buttons.checkIn) {
    return null;
  }

  const unassignedUnits = countUnassignedModelUnits(booking.modelRequests);
  // The hover card names the action, since the row's buttons are icons only.
  const checkOutDisabled =
    unassignedUnits > 0
      ? { title: CHECK_OUT_BLOCKED_TITLE, reason: ASSIGN_UNITS_FIRST_REASON }
      : false;

  const dialogBooking = {
    id: booking.id,
    name: booking.name,
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

      <div className="flex items-center gap-2">
        {buttons.checkOut ? (
          busy ? (
            <BusyActionButton {...ACTIONS.checkOut} />
          ) : (
            <CheckoutDialog
              booking={dialogBooking}
              formId={formId}
              intent="checkOut"
              variant="icon"
              {...ACTIONS.checkOut}
              disabled={checkOutDisabled}
            />
          )
        ) : null}

        {buttons.checkOutRemaining ? (
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

        {buttons.checkIn ? (
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
      </div>
    </>
  );
}
