// @vitest-environment node
import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { getBookingsForICalFeed } from "./service.server";

// why: assert the feed's booking-scoping WHERE clause without a real database.
// getBookingsForICalFeed routes through getBookings -> db.booking.findMany, so
// mocking the db lets us prove the security-critical custodian restriction.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    teamMember: {
      findMany: vi.fn(),
    },
  },
}));

const ORG_ID = "org-1";
const USER_ID = "user-1";

/** The `where` clause of the most recent db.booking.findMany call. */
function lastFindManyWhere(): Record<string, unknown> {
  const calls = vi.mocked(db.booking.findMany).mock.calls;
  const args = calls.at(-1)?.[0] as { where: Record<string, unknown> };
  return args.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.booking.findMany).mockResolvedValue([] as never);
  vi.mocked(db.booking.count).mockResolvedValue(0 as never);
});

describe("getBookingsForICalFeed scoping", () => {
  it("restricts a member who can't see all bookings to their own (custodian user OR team member)", async () => {
    vi.mocked(db.teamMember.findMany).mockResolvedValue([
      { id: "tm-1" },
    ] as never);

    await getBookingsForICalFeed({
      organizationId: ORG_ID,
      userId: USER_ID,
      canSeeAllBookings: false,
    });

    const where = lastFindManyWhere();
    expect(where.organizationId).toBe(ORG_ID);
    // Security property (unchanged): a restricted member only ever sees their
    // own bookings, matched by custodian user OR their linked team member —
    // never others'.
    //
    // This OR used to sit at the top level of `where`. It now lives INSIDE a
    // single `AND` member: the two halves are OR-ed with each other, and the
    // whole clause is AND-ed into the query. That nesting is what stops a
    // user-supplied `?teamMember=` filter from OR-ing the restriction away, and
    // keeps the restriction out of the single top-level `OR` slot that the
    // search block also writes. Only the assertion's location moved — a
    // restricted member matching on the team-member link alone (legacy rows with
    // a null `custodianUserId`) is still covered, and this assertion still fails
    // if the two halves are ever AND-ed instead of OR-ed.
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { custodianUserId: USER_ID },
            { custodianTeamMemberId: { in: ["tm-1"] } },
          ],
        },
      ])
    );
    expect(where.OR).toBeUndefined();
    expect(where.custodianUserId).toBeUndefined();
  });

  it("does NOT restrict by custodian when the member can see all bookings", async () => {
    await getBookingsForICalFeed({
      organizationId: ORG_ID,
      userId: USER_ID,
      canSeeAllBookings: true,
    });

    const where = lastFindManyWhere();
    expect(where.organizationId).toBe(ORG_ID);
    expect(where.custodianUserId).toBeUndefined();
    // privileged roles never need a team-member lookup
    expect(db.teamMember.findMany).not.toHaveBeenCalled();
    // the feed renders rows only — it must not run the wasted COUNT companion
    expect(db.booking.count).not.toHaveBeenCalled();
  });

  it("only includes active statuses (excludes DRAFT/ARCHIVED/CANCELLED)", async () => {
    await getBookingsForICalFeed({
      organizationId: ORG_ID,
      userId: USER_ID,
      canSeeAllBookings: true,
    });

    expect(lastFindManyWhere().status).toEqual({
      in: [
        BookingStatus.RESERVED,
        BookingStatus.ONGOING,
        BookingStatus.OVERDUE,
        BookingStatus.COMPLETE,
      ],
    });
  });

  it("throws if a restricted member has no team-member record", async () => {
    vi.mocked(db.teamMember.findMany).mockResolvedValue([] as never);

    await expect(
      getBookingsForICalFeed({
        organizationId: ORG_ID,
        userId: USER_ID,
        canSeeAllBookings: false,
      })
    ).rejects.toThrow();
  });

  it("includes ALL of a member's team-member links in the restriction, not just one", async () => {
    // A user can hold more than one TeamMember row per org (no unique
    // constraint), and a legacy booking's custody may point at any of them.
    // Resolving only the first would silently hide those bookings.
    vi.mocked(db.teamMember.findMany).mockResolvedValue([
      { id: "tm-1" },
      { id: "tm-2" },
    ] as never);

    await getBookingsForICalFeed({
      organizationId: ORG_ID,
      userId: USER_ID,
      canSeeAllBookings: false,
    });

    expect(lastFindManyWhere().AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { custodianUserId: USER_ID },
            { custodianTeamMemberId: { in: ["tm-1", "tm-2"] } },
          ],
        },
      ])
    );
  });
});
