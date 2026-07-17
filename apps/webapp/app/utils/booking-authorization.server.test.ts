/**
 * Unit tests for the booking custody read gate.
 *
 * `canSeeBooking` is the single predicate behind every booking detail-level
 * read gate (overview loader, activity loader, activity note action, activity
 * CSV export). The cases below pin down the two directions that matter:
 *
 * - A booking whose custody is recorded ONLY on the team-member link must stay
 *   readable by the user that team member belongs to. Matching the user link
 *   alone fails closed here, which is what made rows appear on the index and
 *   then 403 on click.
 * - Another user's booking must still be refused — this is what proves the
 *   fix above did not widen access.
 *
 * @see {@link file://./booking-authorization.server.ts}
 */
import { describe, expect, it } from "vitest";

import { canSeeBooking } from "./booking-authorization.server";

const ME = "user-me";
const SOMEONE_ELSE = "user-victim";

describe("canSeeBooking", () => {
  describe("when the caller cannot see all bookings", () => {
    it("allows a booking held via the user link", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: { custodianUserId: ME, custodianTeamMember: null },
          userId: ME,
        })
      ).toBe(true);
    });

    /**
     * The legacy class this gate exists for: assigned to a team member while no
     * user was attached, linked only later when the invite was accepted. The
     * booking never gets a `custodianUserId`, so the user link alone can't see
     * it — yet the index lists it.
     */
    it("allows a legacy booking held via the team-member link alone", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: {
            custodianUserId: null,
            custodianTeamMember: { userId: ME },
          },
          userId: ME,
        })
      ).toBe(true);
    });

    it("refuses another user's booking on both links", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: {
            custodianUserId: SOMEONE_ELSE,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(false);
    });

    it("refuses a booking whose team member belongs to another user", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: {
            custodianUserId: null,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(false);
    });

    /**
     * An unlinked team member (`userId: null`) must never match. Without the
     * explicit requester comparison a nullish-vs-nullish check would hand every
     * unclaimed booking to any caller.
     */
    it("refuses a booking whose team member has no user attached", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: {
            custodianUserId: null,
            custodianTeamMember: { userId: null },
          },
          userId: ME,
        })
      ).toBe(false);
    });

    it("refuses an unassigned booking", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: { custodianUserId: null, custodianTeamMember: null },
          userId: ME,
        })
      ).toBe(false);
    });

    it("refuses when the team-member relation was not selected", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: false,
          booking: { custodianUserId: SOMEONE_ELSE },
          userId: ME,
        })
      ).toBe(false);
    });
  });

  describe("when the caller can see all bookings", () => {
    it("allows another user's booking", () => {
      expect(
        canSeeBooking({
          canSeeAllBookings: true,
          booking: {
            custodianUserId: SOMEONE_ELSE,
            custodianTeamMember: { userId: SOMEONE_ELSE },
          },
          userId: ME,
        })
      ).toBe(true);
    });
  });
});
