/**
 * Visibility regression tests for `loadBookingsData`.
 *
 * This is the loader that seeds the "Add to existing booking" pickers. It has
 * to apply the SAME booking-visibility rule as the search endpoint those
 * pickers switch to once the user types (`/api/model-filters`), or the list
 * silently changes the moment someone types into the search box.
 *
 * The rule is the standard one: SELF_SERVICE / BASE users see only bookings
 * they are custodian of, unless the workspace has switched
 * `selfServiceCanSeeBookings` / `baseUserCanSeeBookings` on. `requirePermission`
 * resolves that into `canSeeAllBookings`, which is what this loader now takes.
 * It previously gated on the role alone, so the workspace override never
 * reached these two dialogs.
 *
 * Asserts on the `where` handed to Prisma, because the `where` is the boundary.
 *
 * @see {@link file://./service.server.ts} — `loadBookingsData`
 * @see {@link file://./../../routes/api+/model-filters.ts}
 */
import { db } from "~/database/db.server";
import { loadBookingsData } from "./service.server";

// @vitest-environment node

// why: the subject is the `where` the loader ends up building, not what a
// database returns. `count` is mocked because `getBookings` issues it alongside
// `findMany`; `teamMember.findMany` because `resolveCustodianScope` reads it.
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vitest.fn().mockResolvedValue([]),
      count: vitest.fn().mockResolvedValue(0),
    },
    teamMember: {
      findMany: vitest.fn().mockResolvedValue([{ id: "tm-1" }]),
    },
  },
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;

const ORGANIZATION_ID = "org-1";
const USER_ID = "user-1";

/** The restriction `resolveCustodianScope` produces for our fixture user. */
const CUSTODIAN_RESTRICTION = {
  OR: [
    { custodianUserId: USER_ID },
    { custodianTeamMemberId: { in: ["tm-1"] } },
  ],
};

/**
 * Runs the loader and returns the `where` Prisma was asked for.
 *
 * @param canSeeAllBookings - The resolved visibility flag under test.
 * @returns The Prisma `where` from the resulting booking query.
 */
async function whereFor(canSeeAllBookings: boolean) {
  findManyMock.mockClear();

  await loadBookingsData({
    request: new Request(
      "http://localhost/assets/a1/overview/add-to-existing-booking"
    ),
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    canSeeAllBookings,
    ids: ["a1"],
  });

  return findManyMock.mock.calls.at(-1)?.[0]?.where;
}

describe("loadBookingsData booking visibility", () => {
  it("restricts to the caller's own bookings when they may not see all", async () => {
    const where = await whereFor(false);

    expect(where.AND).toEqual(
      expect.arrayContaining([expect.objectContaining(CUSTODIAN_RESTRICTION)])
    );
  });

  it("does not restrict when the caller may see all bookings", async () => {
    const where = await whereFor(true);

    const restrictions = (where.AND ?? []).filter(
      (clause: Record<string, unknown>) =>
        JSON.stringify(clause).includes("custodianTeamMemberId") ||
        JSON.stringify(clause).includes("custodianUserId")
    );

    expect(restrictions).toEqual([]);
  });

  it("never drops the draft-visibility clause, whichever way the flag goes", async () => {
    for (const flag of [true, false]) {
      const where = await whereFor(flag);
      const serialized = JSON.stringify(where.AND ?? []);

      expect(serialized).toContain("DRAFT");
      expect(serialized).toContain("creatorId");
    }
  });
});
