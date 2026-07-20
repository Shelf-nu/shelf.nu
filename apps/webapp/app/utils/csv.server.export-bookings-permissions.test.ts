/**
 * Permission regression tests for `exportBookingsFromIndexToCsv`'s
 * where-construction on the explicit-ids (non-select-all) branch.
 *
 * That branch receives `bookingsIds` straight from the `?bookingsIds=` query
 * param of the export route, so the values are attacker-controlled. Because
 * `booking.export` is granted to BASE and SELF_SERVICE, an org-scoped-only
 * query lets the two lowest-privilege roles export any booking in the
 * organization by supplying its id.
 *
 * These tests assert on the `where` handed to Prisma rather than on query
 * results, because the `where` *is* the security boundary. They mirror the
 * conventions of `modules/booking/service.server.get-bookings-permissions.test.ts`.
 *
 * @see {@link file://./csv.server.ts} — `exportBookingsFromIndexToCsv`
 * @see {@link file://./../routes/_layout+/bookings.export.$fileName[.csv].tsx}
 */
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { bookingDraftVisibilityClause } from "~/modules/booking/service.server";
import { exportBookingsFromIndexToCsv } from "./csv.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: the subject under test is the `where` the export builds, not what a
// database returns. Mocking the client lets us capture that argument.
// `teamMember.findMany` is mocked because the restriction resolves ALL of the
// caller's own team-member ids to match custody recorded on either link, and
// `partialBookingCheckin.findMany` because the export batches check-in state
// for the rows it fetched.
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    teamMember: {
      findMany: vitest.fn().mockResolvedValue([{ id: "own-team-member-1" }]),
    },
    partialBookingCheckin: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
  },
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;

/** The restricted (self-service / base) caller these tests act as. */
const RESTRICTED_USER_ID = "restricted-user-1";

/** The restricted caller's own team-member row in this org. */
const OWN_TEAM_MEMBER_ID = "own-team-member-1";

const ORGANIZATION_ID = "org-1";

/** A booking the restricted caller is not the custodian of. */
const VICTIM_BOOKING_ID = "victim-booking-1";

/**
 * Runs the export and returns the `where` it handed to `db.booking.findMany`.
 *
 * @param canSeeAllBookings - Whether the caller may export bookings they don't own
 * @returns The captured Prisma where-input
 */
async function captureWhere(
  canSeeAllBookings: boolean
): Promise<Prisma.BookingWhereInput> {
  await exportBookingsFromIndexToCsv({
    request: new Request("http://localhost/bookings/export/bookings.csv"),
    userId: RESTRICTED_USER_ID,
    bookingsIds: [VICTIM_BOOKING_ID],
    canSeeAllBookings,
    organizationId: ORGANIZATION_ID,
  });

  return findManyMock.mock.calls[0][0].where as Prisma.BookingWhereInput;
}

beforeEach(() => {
  vitest.clearAllMocks();
  findManyMock.mockResolvedValue([]);
});

describe("exportBookingsFromIndexToCsv — explicit bookingsIds branch", () => {
  it("restricts a caller who cannot see all bookings to their own custody", async () => {
    const where = await captureWhere(false);

    // The org scope alone is NOT enough: `bookingsIds` is unvalidated input.
    expect(where.organizationId).toBe(ORGANIZATION_ID);
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { custodianUserId: RESTRICTED_USER_ID },
            { custodianTeamMemberId: { in: [OWN_TEAM_MEMBER_ID] } },
          ],
        },
      ])
    );
  });

  it("applies the DRAFT-visibility rule so other users' drafts can't be exported", async () => {
    const where = await captureWhere(false);

    expect(where.AND).toEqual(
      expect.arrayContaining([bookingDraftVisibilityClause(RESTRICTED_USER_ID)])
    );
  });

  it("does not restrict custody for a caller who can see all bookings", async () => {
    const where = await captureWhere(true);

    // Admins/owners export exactly what they selected.
    expect(JSON.stringify(where.AND ?? [])).not.toContain("custodianUserId");
    expect(where).not.toHaveProperty("custodianUserId");
    // The DRAFT rule still applies to everyone.
    expect(where.AND).toEqual(
      expect.arrayContaining([bookingDraftVisibilityClause(RESTRICTED_USER_ID)])
    );
  });

  it("does not look up team members for a caller who can see all bookings", async () => {
    await captureWhere(true);

    expect(db.teamMember.findMany).not.toHaveBeenCalled();
  });
});
