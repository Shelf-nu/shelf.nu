/**
 * What a change that asks for more does to a booking's approval.
 *
 * Rule: an approval covers what was approved. When a member whose own
 * reservations need approval (their role's approval switch is on) changes a
 * booking so that it asks for MORE (a booked amount raised, a model
 * reservation added or raised, the end date moved later):
 * - on an approved RESERVED booking, the approval is cleared in the same
 *   transaction and the booking is a pending request again;
 * - on a booking already checked out (ONGOING or OVERDUE), the change is
 *   refused: the extra items would leave without anyone approving them. The
 *   member asks someone who can approve to add it, or makes a new booking
 *   request for the extra items.
 * Asking for less (lowering an amount, removing items) is unaffected, and so
 * is a change made by someone who may approve or by a role whose switch is off.
 *
 * Adding assets or kits, and scans that add them, are closed to these roles
 * once a booking is past DRAFT (`canManageBookingItems`), and no role changes
 * a booking's start once it is past DRAFT, so the paths this rule guards are
 * the booked amounts, the model reservations and the extension of a started
 * booking.
 *
 * Every write that can ask for more runs this before it commits.
 *
 * @see {@link file://./booked-quantity.server.ts}
 * @see {@link file://../booking-model-request/service.server.ts}
 * @see {@link file://./service.server.ts} `extendBooking`
 */
import { BookingStatus } from "@prisma/client";
import type { Booking, Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  BOOKING_APPROVAL_SWITCHES_SELECT,
  roleReservesAsRequest,
  type BookingApprovalSwitches,
} from "~/utils/bookings";
import { ShelfError } from "~/utils/error";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { ROLE_POLICIES, resolveRole } from "~/utils/permissions/role-access";
import { createSystemBookingNote } from "../booking-note/service.server";
import { USER_NAME_SELECT } from "../user/fields";

/** A transaction client that can read and write bookings and their notes. */
type RequestChangeTx = Pick<
  typeof db,
  "booking" | "bookingNote" | "bookingSettings" | "user" | "userOrganization"
>;

/**
 * Applies the rule above to one change that asks for more. Call it only for
 * such a change; a change that asks for less needs nothing.
 *
 * Clearing writes an activity note so the history shows why the booking is
 * pending again. The earlier `BOOKING_APPROVED` event stays: it is what
 * happened.
 *
 * @param tx - The transaction making the change, holding the booking row lock
 *   where the caller takes one
 * @param args.bookingId - The booking whose request grew
 * @param args.organizationId - Its workspace
 * @param args.actorUserId - Who made the change; a system write has none and
 *   is not held to the rule
 * @returns `true` when the approval was cleared
 * @throws {ShelfError} 400 when the booking has already been checked out and
 *   the actor's own reservations need approval
 */
export async function applyRequestGrowthRule(
  tx: RequestChangeTx,
  {
    bookingId,
    organizationId,
    actorUserId,
  }: {
    bookingId: Booking["id"];
    organizationId: Organization["id"];
    actorUserId: User["id"] | null | undefined;
  }
): Promise<boolean> {
  if (!actorUserId) return false;
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: { status: true, approvedAt: true },
  });
  if (!booking) return false;
  const isApprovedReservation =
    booking.status === BookingStatus.RESERVED && booking.approvedAt !== null;
  const hasStarted =
    booking.status === BookingStatus.ONGOING ||
    booking.status === BookingStatus.OVERDUE;
  // A draft, a request still pending, or a closed booking: nothing to guard.
  if (!isApprovedReservation && !hasStarted) return false;

  // Only a member whose own reservation would be a request is held to the
  // rule. Everyone else (approvers, and a role whose switch is off) is not.
  const switches = await tx.bookingSettings.findUnique({
    where: { organizationId },
    select: BOOKING_APPROVAL_SWITCHES_SELECT,
  });
  if (
    !(await actorReservesAsRequest({
      actorUserId,
      organizationId,
      settings: switches,
      client: tx,
    }))
  ) {
    return false;
  }

  // A booking already out cannot become a request again: the extra items
  // would leave without anyone approving them. Refused, with both ways out.
  if (hasStarted) {
    throw new ShelfError({
      cause: null,
      title: "Approval required",
      message:
        "This booking has already been checked out, so it can't ask for more now. Ask someone who can approve bookings to add it, or make a new booking request for the extra items.",
      additionalData: { bookingId, status: booking.status },
      label: "Booking",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  await tx.booking.updateMany({
    where: { id: bookingId, organizationId },
    data: { approvedAt: null, approvedById: null },
  });

  // Through the transaction: no second connection while its locks are held.
  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, ...USER_NAME_SELECT } satisfies Prisma.UserSelect,
  });
  await createSystemBookingNote(
    {
      bookingId,
      organizationId,
      content: `${wrapUserLinkForNote({
        firstName: actor?.firstName ?? null,
        lastName: actor?.lastName ?? null,
        displayName: actor?.displayName ?? null,
        id: actorUserId,
      })} changed the approved booking request to ask for more, so it needs approval again.`,
    },
    tx
  );
  return true;
}

/**
 * Whether the acting user's own reservation in this workspace would be a
 * request, read from their membership in the database rather than from the
 * caller. Decided by the effective role (`resolveRole`), the same role whose
 * policy `access.policy` carries and `reserveBooking` decides by. The one
 * place this rule lives: the check-out gate and the approval-clearing rule
 * both ask it.
 *
 * @param args.actorUserId - The acting user
 * @param args.organizationId - The workspace
 * @param args.settings - The workspace's approval switches
 * @param args.client - Prisma client to read through; the transaction when
 *   called under the booking row lock
 * @returns `true` when the member's reservation would wait for approval
 */
export async function actorReservesAsRequest({
  actorUserId,
  organizationId,
  settings,
  client = db,
}: {
  actorUserId: User["id"];
  organizationId: Organization["id"];
  settings: Partial<BookingApprovalSwitches> | null | undefined;
  /** The transaction, when called under the booking row lock. */
  client?: Pick<typeof db, "userOrganization">;
}): Promise<boolean> {
  const membership = await client.userOrganization.findUnique({
    where: { userId_organizationId: { userId: actorUserId, organizationId } },
    select: { roles: true },
  });
  if (!membership) return false;
  return roleReservesAsRequest({
    approvalSetting:
      ROLE_POLICIES[resolveRole(membership.roles)].bookings.approvalSetting,
    settings,
  });
}
