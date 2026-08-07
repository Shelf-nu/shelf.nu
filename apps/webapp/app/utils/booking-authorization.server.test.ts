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
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  bookingWriteScopeClause,
  canSeeBooking,
  validateBookingOwnership,
} from "./booking-authorization.server";

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

/**
 * A booking reduced to the two columns both the clause and the gate read.
 */
type BookingRow = { creatorId: string | null; custodianUserId: string | null };

/**
 * Evaluates the clause against a row, the way Postgres would.
 *
 * Deliberately narrow: it understands ONLY the `{ OR: [{ field: value }, …] }`
 * shape {@link bookingWriteScopeClause} emits, and throws on anything else. If
 * the clause grows a construct this cannot evaluate, the equivalence test below
 * fails loudly instead of quietly passing on an unchecked predicate.
 *
 * @param clause - The where-input under test.
 * @param row - The candidate booking.
 * @returns Whether the row would be returned by a query carrying the clause.
 */
function rowMatches(
  clause: Record<string, unknown> | undefined,
  row: BookingRow
): boolean {
  if (!clause) {
    return true; // No restriction — every row qualifies.
  }

  const branches = clause.OR;

  if (!Array.isArray(branches)) {
    throw new Error(
      `Unsupported clause shape: ${JSON.stringify(
        clause
      )}. Extend rowMatches to cover it.`
    );
  }

  return branches.some((branch: Record<string, unknown>) =>
    Object.entries(branch).every(([field, value]) => {
      if (typeof value !== "string") {
        throw new Error(`Unsupported branch: ${JSON.stringify(branch)}`);
      }
      return row[field as keyof BookingRow] === value;
    })
  );
}

/**
 * Runs the submit-time gate and reports whether it let the caller through.
 *
 * @param row - The candidate booking.
 * @param role - The caller's effective role.
 * @returns `true` when {@link validateBookingOwnership} does not throw.
 */
function gateAllows(row: BookingRow, role: OrganizationRoles): boolean {
  try {
    validateBookingOwnership({
      booking: row,
      userId: ME,
      role,
      action: "add items to",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The point of the clause: it is the query-side mirror of the submit-time gate.
 * Any row a picker offers must be one the action will accept, or the user hits
 * a 403 dead end — so these two must agree on EVERY row, for EVERY role.
 */
describe("bookingWriteScopeClause", () => {
  const ROWS: Array<{ label: string; row: BookingRow }> = [
    {
      label: "created and custodied by me",
      row: { creatorId: ME, custodianUserId: ME },
    },
    {
      label: "created by me, custodied by someone else",
      row: { creatorId: ME, custodianUserId: SOMEONE_ELSE },
    },
    {
      label: "created by someone else, custodied by me",
      row: { creatorId: SOMEONE_ELSE, custodianUserId: ME },
    },
    {
      label: "entirely someone else's",
      row: { creatorId: SOMEONE_ELSE, custodianUserId: SOMEONE_ELSE },
    },
    {
      label: "unassigned with no creator",
      row: { creatorId: null, custodianUserId: null },
    },
  ];

  const ROLES = [
    OrganizationRoles.SELF_SERVICE,
    OrganizationRoles.BASE,
    OrganizationRoles.ADMIN,
    OrganizationRoles.OWNER,
  ];

  for (const role of ROLES) {
    for (const { label, row } of ROWS) {
      it(`agrees with validateBookingOwnership for ${role} on a booking ${label}`, () => {
        const clause = bookingWriteScopeClause({ userId: ME, role }) as
          | Record<string, unknown>
          | undefined;

        expect(rowMatches(clause, row)).toBe(gateAllows(row, role));
      });
    }
  }

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "returns no restriction for %s",
    (role) => {
      expect(bookingWriteScopeClause({ userId: ME, role })).toBeUndefined();
    }
  );

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "restricts %s to bookings they created or hold",
    (role) => {
      expect(bookingWriteScopeClause({ userId: ME, role })).toEqual({
        OR: [{ creatorId: ME }, { custodianUserId: ME }],
      });
    }
  );
});
