/**
 * What a change to a booking's contents does to its approval.
 *
 * Rule: an approval covers what was approved. When someone who may not
 * approve changes an approved RESERVED booking so that it asks for MORE (a
 * booked amount raised, a model reservation added or raised), the approval is
 * cleared in the same transaction and the booking is a pending request again.
 * Asking for less (lowering an amount, removing items) keeps the approval, and
 * so does a change made by someone who may approve: their change is their
 * decision. "May not approve" is read as "their own reservation would be a
 * request": a role whose approval switch is off keeps its approval, since its
 * reservations are final.
 *
 * Dates are not in this list because no role can change a booking's period
 * once it is past DRAFT (`updateBasicBooking`); adding assets or kits is
 * closed to roles that cannot approve once a booking is reserved
 * (`canManageBookingItems`), so the item paths a requester can still reach are
 * the booked amounts and the model reservations.
 *
 * Every write that can raise a request runs this inside its transaction,
 * after it has locked the booking row.
 *
 * @see {@link file://./booked-quantity.server.ts}
 * @see {@link file://../booking-model-request/service.server.ts}
 */
import { BookingStatus } from "@prisma/client";
import type { Booking, Organization, Prisma, User } from "@prisma/client";
import type { db } from "~/database/db.server";
import { getUserByID } from "~/modules/user/service.server";
import {
  BOOKING_APPROVAL_SWITCHES_SELECT,
  roleReservesAsRequest,
} from "~/utils/bookings";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { ROLE_POLICIES, resolveRole } from "~/utils/permissions/role-access";
import { createSystemBookingNote } from "../booking-note/service.server";
import { USER_NAME_SELECT } from "../user/fields";

/** A transaction client that can read and write bookings and their notes. */
type RequestChangeTx = Pick<
  typeof db,
  "booking" | "bookingNote" | "bookingSettings" | "userOrganization"
>;

/**
 * Clears the approval of an approved RESERVED booking whose request grew,
 * when the actor may not approve. Call it only for a change that asks for
 * more; a change that asks for less keeps the approval.
 *
 * Writes an activity note so the history shows why the booking is pending
 * again. The earlier `BOOKING_APPROVED` event stays: it is what happened.
 *
 * @param tx - The transaction making the change, holding the booking row lock
 * @param args.bookingId - The booking whose request grew
 * @param args.organizationId - Its workspace
 * @param args.actorUserId - Who made the change; a system write has none and
 *   keeps the approval
 * @returns `true` when the approval was cleared
 */
export async function clearApprovalWhenRequestGrows(
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
  if (
    !booking ||
    booking.status !== BookingStatus.RESERVED ||
    booking.approvedAt === null
  ) {
    return false;
  }

  // Only a member whose own reservation would be a request loses the
  // approval: their role's switch decides, by their effective role, as it
  // does for `reserveBooking`. Everyone else (approvers, and a role whose
  // switch is off) keeps it.
  const [membership, switches] = await Promise.all([
    tx.userOrganization.findUnique({
      where: { userId_organizationId: { userId: actorUserId, organizationId } },
      select: { roles: true },
    }),
    tx.bookingSettings.findUnique({
      where: { organizationId },
      select: BOOKING_APPROVAL_SWITCHES_SELECT,
    }),
  ]);
  if (
    !membership ||
    !roleReservesAsRequest({
      approvalSetting:
        ROLE_POLICIES[resolveRole(membership.roles)].bookings.approvalSetting,
      settings: switches,
    })
  ) {
    return false;
  }

  await tx.booking.updateMany({
    where: { id: bookingId, organizationId },
    data: { approvedAt: null, approvedById: null },
  });

  const actor = await getUserByID(actorUserId, {
    select: { id: true, ...USER_NAME_SELECT } satisfies Prisma.UserSelect,
  });
  await createSystemBookingNote(
    {
      bookingId,
      organizationId,
      content: `${wrapUserLinkForNote({
        ...actor,
        id: actorUserId,
      })} changed the approved booking request to ask for more, so it needs approval again.`,
    },
    tx
  );
  return true;
}
