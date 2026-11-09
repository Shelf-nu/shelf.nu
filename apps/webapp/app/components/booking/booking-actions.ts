/**
 * The rules for which actions a viewer is offered on a booking, and why one is
 * disabled. One pure function ({@link resolveBookingActions}) answers for every
 * surface that lists booking actions (the bookings list row and the booking
 * page), so the surfaces cannot disagree about what a viewer may do.
 *
 * Every action is hidden unless the viewer may act on the booking at all
 * ({@link canActOnBooking}): they write every booking, or they hold it.
 * Beyond that each action has its own status and grant rule, see the table in
 * {@link resolveBookingActions}. The checks are cosmetic: each mutation is
 * enforced again by its server action.
 *
 * Client-safe: nothing here imports a `.server` module.
 *
 * @see {@link file://./booking-quick-actions.tsx} the list row's buttons
 * @see {@link file://./forms/edit-booking-form.tsx} the booking page, `canSeeActions`
 * @see {@link file://./../../utils/bookings.ts} `canWriteBooking`, the server's wider rule
 */
import { BookingStatus } from "@prisma/client";
import type { OrganizationRoles } from "@prisma/client";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useRoleAccess } from "~/hooks/use-role-access";
import { useUserData } from "~/hooks/use-user-data";
import { isExtendableStatus } from "~/modules/booking/extend-eligibility";
import { isBookingArchivable } from "~/modules/booking/helpers";
import type { CountableModelRequest } from "~/utils/booking-model-requests";
import { countUnassignedModelUnits } from "~/utils/booking-model-requests";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { isExplicitScanRequired } from "~/utils/permissions/role-access";
import type { RoleAccess } from "~/utils/permissions/role-access";

/** Every action a booking can offer, on the list row or the booking page. */
export type BookingActionKey =
  | "checkOut"
  | "checkOutRemaining"
  | "checkIn"
  | "extend"
  | "cancel"
  | "archive"
  | "duplicate"
  | "bookingDocument"
  | "checkinReceipt"
  | "revertToDraft"
  | "delete"
  | "manageNotifications";

/** Same shape as Button's `disabled` prop. */
export type BookingActionDisabled = false | { title?: string; reason: string };

/** Whether an action is offered, and if so whether it can be used now. */
export type BookingActionState =
  | { visible: false }
  | { visible: true; disabled: BookingActionDisabled };

/** The state of every action for one booking and one viewer. */
export type BookingActions = Record<BookingActionKey, BookingActionState>;

/** What the rules read off a booking. */
export type BookingActionsBooking = {
  status: BookingStatus;
  to: Date | string | null;
  custodianUserId: string | null;
  /** `custodianTeamMember.userId`, the second custody link. */
  custodianTeamMemberUserId: string | null;
  /** Concrete assets on the booking; zero disables the booking document. */
  assetCount: number;
  /** Reserved model units, to disable Check out while some are unassigned. */
  modelRequests: CountableModelRequest[];
  /** Whether "Check out remaining" would find something to send. */
  hasItemsToCheckOut?: boolean;
  /** Absent reads as "receipt not available", which disables the receipt. */
  canPrintCheckinReceipt?: boolean;
  /**
   * Why the receipt is unavailable, for its disabled state. The booking page
   * knows the specific reason; without one the generic
   * {@link NO_CHECKIN_RECEIPT_REASON} is shown.
   */
  checkinReceiptUnavailableReason?: string;
};

/** Who is looking: their roles, resolved reach and the workspace's switches. */
export type BookingActionsViewer = {
  userId: string;
  roles: OrganizationRoles[] | undefined;
  access: RoleAccess;
  bookingSettings: Parameters<typeof isExplicitScanRequired>[0]["settings"];
};

/** Why a RESERVED booking's Check out is disabled while model units are unassigned. */
export const ASSIGN_UNITS_FIRST_REASON =
  "Open the booking to assign the reserved units first.";

/** The heading of that reason's hover card, naming the blocked action. */
const CHECK_OUT_BLOCKED_TITLE = "Can't check out yet";

/** Why the booking document is disabled on a booking with no assets. */
export const NO_ASSETS_PDF_REASON = "No assets in booking to generate a PDF.";

/** Why the check-in receipt is disabled when no specific reason is given. */
export const NO_CHECKIN_RECEIPT_REASON = "Nothing has been checked in yet.";

/**
 * Whether the viewer may act on this booking at all: they write every booking,
 * or they hold it through either custody link (the user link or the
 * team-member's user). Creating a booking does not count; a creator who is not
 * the custodian has no actions.
 *
 * @param args.booking - The booking's two custody links
 * @param args.userId - The viewer
 * @param args.access - The viewer's resolved access
 * @returns `true` when actions are offered on this booking
 */
export function canActOnBooking({
  booking,
  userId,
  access,
}: {
  booking: Pick<
    BookingActionsBooking,
    "custodianUserId" | "custodianTeamMemberUserId"
  >;
  userId: string;
  access: Pick<RoleAccess, "bookings">;
}): boolean {
  return (
    access.bookings.writeAll ||
    booking.custodianUserId === userId ||
    booking.custodianTeamMemberUserId === userId
  );
}

/**
 * Whether the viewer can move a booking in one direction with a single click:
 * they hold the grant for it and the workspace does not hold their role to the
 * explicit (scan or select) flow, which the server enforces too.
 *
 * @param args.roles - The viewer's roles
 * @param args.access - The viewer's resolved access
 * @param args.settings - The workspace's explicit scan switches
 * @param args.direction - Which way the booking moves
 * @returns `true` when the one-click action is allowed
 */
export function canQuickMove({
  roles,
  access,
  settings,
  direction,
}: {
  roles: OrganizationRoles[] | undefined;
  access: BookingActionsViewer["access"];
  settings: BookingActionsViewer["bookingSettings"];
  direction: "checkout" | "checkin";
}): boolean {
  return (
    userHasPermission({
      roles,
      entity: PermissionEntity.booking,
      action:
        direction === "checkout"
          ? PermissionAction.checkout
          : PermissionAction.checkin,
    }) && !isExplicitScanRequired({ access, settings, direction })
  );
}

/** An action that is offered and usable. */
const SHOWN: BookingActionState = { visible: true, disabled: false };

/** An action that is not offered. */
const HIDDEN: BookingActionState = { visible: false };

/**
 * Turns a condition into an offered-and-usable or hidden state.
 *
 * @param visible - Whether the action is offered
 * @param disabled - Why it cannot be used yet, when it is offered
 */
function state(
  visible: boolean,
  disabled: BookingActionDisabled = false
): BookingActionState {
  if (!visible) return HIDDEN;
  return disabled === false ? SHOWN : { visible: true, disabled };
}

/**
 * Decides every action's state for one booking and one viewer.
 *
 * | Key                 | Visible when                                                   | Disabled when                |
 * | ------------------- | -------------------------------------------------------------- | ---------------------------- |
 * | checkOut            | RESERVED and the viewer can quick check out                    | model units unassigned       |
 * | checkOutRemaining   | ONGOING/OVERDUE, can quick check out, items left to check out  | never                        |
 * | checkIn             | ONGOING/OVERDUE and the viewer can quick check in              | never                        |
 * | extend              | extendable status and `booking:extend`                         | never                        |
 * | cancel              | RESERVED/ONGOING/OVERDUE and `booking:cancel`                  | never                        |
 * | archive             | archivable and `booking:archive`                               | never                        |
 * | duplicate           | always                                                         | never                        |
 * | bookingDocument     | documents allowed for the viewer                               | no assets                    |
 * | checkinReceipt      | documents allowed                                              | receipt not available        |
 * | revertToDraft       | RESERVED                                                       | never                        |
 * | delete              | `booking:delete`, and DRAFT for roles limited to drafts        | never                        |
 * | manageNotifications | the role manages recipients and the booking is not closed      | never                        |
 *
 * Every action is hidden when {@link canActOnBooking} is false.
 *
 * @param args.booking - The booking
 * @param args.viewer - Who is looking
 * @returns The state of every action
 */
export function resolveBookingActions({
  booking,
  viewer,
}: {
  booking: BookingActionsBooking;
  viewer: BookingActionsViewer;
}): BookingActions {
  const { roles, access, bookingSettings, userId } = viewer;
  const { status } = booking;

  if (!canActOnBooking({ booking, userId, access })) {
    return {
      checkOut: HIDDEN,
      checkOutRemaining: HIDDEN,
      checkIn: HIDDEN,
      extend: HIDDEN,
      cancel: HIDDEN,
      archive: HIDDEN,
      duplicate: HIDDEN,
      bookingDocument: HIDDEN,
      checkinReceipt: HIDDEN,
      revertToDraft: HIDDEN,
      delete: HIDDEN,
      manageNotifications: HIDDEN,
    };
  }

  const isReserved = status === BookingStatus.RESERVED;
  const isUnderway =
    status === BookingStatus.ONGOING || status === BookingStatus.OVERDUE;
  const isClosed =
    status === BookingStatus.COMPLETE ||
    status === BookingStatus.ARCHIVED ||
    status === BookingStatus.CANCELLED;

  const canCheckOut = canQuickMove({
    roles,
    access,
    settings: bookingSettings,
    direction: "checkout",
  });
  const canCheckIn = canQuickMove({
    roles,
    access,
    settings: bookingSettings,
    direction: "checkin",
  });
  const can = (action: PermissionAction) =>
    userHasPermission({ roles, entity: PermissionEntity.booking, action });

  // Mirrors the server's document guard: roles that may not download others'
  // documents still get them on a booking they hold.
  const canUseDocuments =
    access.policy.bookings.documentsForOthers ||
    booking.custodianUserId === userId;

  const unassignedUnits = countUnassignedModelUnits(booking.modelRequests);

  return {
    checkOut: state(
      isReserved && canCheckOut,
      unassignedUnits > 0
        ? { title: CHECK_OUT_BLOCKED_TITLE, reason: ASSIGN_UNITS_FIRST_REASON }
        : false
    ),
    checkOutRemaining: state(
      isUnderway && canCheckOut && booking.hasItemsToCheckOut === true
    ),
    checkIn: state(isUnderway && canCheckIn),
    extend: state(isExtendableStatus(status) && can(PermissionAction.extend)),
    cancel: state((isReserved || isUnderway) && can(PermissionAction.cancel)),
    archive: state(
      isBookingArchivable({ status, to: booking.to }) &&
        can(PermissionAction.archive)
    ),
    duplicate: SHOWN,
    bookingDocument: state(
      canUseDocuments,
      booking.assetCount === 0 ? { reason: NO_ASSETS_PDF_REASON } : false
    ),
    checkinReceipt: state(
      canUseDocuments,
      booking.canPrintCheckinReceipt === true
        ? false
        : {
            reason:
              booking.checkinReceiptUnavailableReason ??
              NO_CHECKIN_RECEIPT_REASON,
          }
    ),
    revertToDraft: state(isReserved),
    delete: state(
      can(PermissionAction.delete) &&
        (!access.policy.bookings.deleteOnlyDrafts ||
          status === BookingStatus.DRAFT)
    ),
    manageNotifications: state(
      access.policy.notifications.manageBookingRecipients && !isClosed
    ),
  };
}

/**
 * Hook form of {@link resolveBookingActions}: reads the viewer's roles, access,
 * workspace switches and user id from the layout hooks.
 *
 * Before the signed-in user is known (an empty id matches no custody link) only
 * a role that writes every booking sees actions.
 *
 * @param booking - The booking the actions are for
 * @returns The state of every action
 */
export function useBookingActions(
  booking: BookingActionsBooking
): BookingActions {
  const roles = useOrganizationRoles();
  const access = useRoleAccess();
  const bookingSettings = useBookingSettings();
  const userId = useUserData()?.id ?? "";

  return resolveBookingActions({
    booking,
    viewer: { userId, roles, access, bookingSettings },
  });
}
