/**
 * Booking custodian resolution for the web booking forms.
 *
 * The booking form posts the picked custodian as JSON (`{ id, name, userId }`).
 * Only the team member id is trusted, and only after it is found in the
 * caller's workspace: the user id written to the booking is the one linked to
 * that team member row, never the posted value. A member whose booking
 * custodian is fixed to themself (`bookingCustodianIsSelf`) may only name a
 * team member linked to their own user.
 *
 * The mobile routes apply the same rule inline.
 *
 * @see {@link file://./../../routes/_layout+/bookings.new.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx}
 * @see {@link file://./../../routes/api+/mobile+/bookings.create.ts}
 */
import type { TeamMember, User } from "@prisma/client";
import { getTeamMember } from "~/modules/team-member/service.server";
import { bookingCustodianIsSelf } from "~/utils/bookings";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import type { RoleAccess } from "~/utils/permissions/role-access";

/** Arguments for {@link resolveBookingCustodian}. */
type ResolveBookingCustodianArgs = {
  /** Team member id taken from the submitted form. */
  custodianTeamMemberId: TeamMember["id"];
  /** The caller's (validated) organization id. */
  organizationId: string;
  /** The signed-in user submitting the form. */
  userId: User["id"];
  /** The caller's resolved role access. */
  access: Pick<RoleAccess, "policy">;
  /**
   * The booking's current custodian team member, when editing an existing
   * booking. Keeping that custodian is not an assignment, so the self-only
   * rule applies only when the custodian changes.
   */
  currentCustodianTeamMemberId?: TeamMember["id"] | null;
};

/**
 * Loads the booking custodian from the caller's workspace and enforces the
 * self-only custodian rule.
 *
 * @param args - See {@link ResolveBookingCustodianArgs}
 * @returns The team member id and the user id linked to it (`null` for a
 *   non-registered member). Write these to the booking.
 * @throws {ShelfError} 404 when the team member is not in the workspace
 * @throws {ShelfError} 403 when a self-only caller names another member
 */
export async function resolveBookingCustodian({
  custodianTeamMemberId,
  organizationId,
  userId,
  access,
  currentCustodianTeamMemberId,
}: ResolveBookingCustodianArgs): Promise<{
  id: TeamMember["id"];
  userId: User["id"] | null;
}> {
  const custodian = await getTeamMember({
    id: custodianTeamMemberId,
    organizationId,
    select: { id: true, userId: true },
  }).catch((cause) => {
    // A missing team member is the caller's mistake (404, not reported); a
    // database failure keeps its own status and still reaches Sentry.
    // `getTeamMember` marks only a genuine not-found as not worth capturing.
    const notFound = isLikeShelfError(cause)
      ? !cause.shouldBeCaptured
      : isNotFoundError(cause);
    throw new ShelfError({
      cause,
      title: notFound ? "Team member not found" : undefined,
      message: notFound
        ? "The selected team member could not be found."
        : "Something went wrong while loading the selected team member.",
      additionalData: { userId, custodianTeamMemberId },
      label: "Booking",
      status: notFound ? 404 : 500,
      shouldBeCaptured: !notFound,
    });
  });

  const custodianChanges = custodian.id !== currentCustodianTeamMemberId;

  if (
    custodianChanges &&
    bookingCustodianIsSelf(access) &&
    custodian.userId !== userId
  ) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: "Self user can assign booking to themselves only.",
      additionalData: { userId, custodianTeamMemberId },
      label: "Booking",
      status: 403,
      shouldBeCaptured: false,
    });
  }

  return { id: custodian.id, userId: custodian.userId ?? null };
}
