/**
 * Visibility regression tests for `loadBookingsData`.
 *
 * This is the loader that seeds the "Add to existing booking" pickers. It has
 * to apply the SAME rules as the search endpoint those pickers switch to once
 * the user types (`/api/model-filters`), or the list silently changes the
 * moment someone types into the search box.
 *
 * There are TWO rules, and both surfaces AND both of them:
 *
 * 1. READ — the standard visibility rule: SELF_SERVICE / BASE users see only
 *    bookings they are custodian of (via EITHER custody link), unless the
 *    workspace has switched `selfServiceCanSeeBookings` /
 *    `baseUserCanSeeBookings` on. `requirePermission` resolves that into
 *    `canSeeAllBookings`. This loader previously gated on the role alone, so
 *    the workspace override never reached these two dialogs.
 * 2. WRITE — what `validateBookingOwnership` accepts on submit: creator OR
 *    custodian, for SELF_SERVICE / BASE, independent of that toggle. A picker
 *    exists to choose a mutation target, so offering a row the action then
 *    rejects is a 403 dead end.
 *
 * Asserts on the `where` handed to Prisma, because the `where` is the boundary.
 *
 * @see {@link file://./service.server.ts} — `loadBookingsData`
 * @see {@link file://./../../routes/api+/model-filters.ts}
 * @see {@link file://./../../utils/booking-authorization.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
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

/** The READ restriction `resolveCustodianScope` produces for our fixture user. */
const CUSTODIAN_RESTRICTION = {
  OR: [
    { custodianUserId: USER_ID },
    { custodianTeamMemberId: { in: ["tm-1"] } },
  ],
};

/** The WRITE restriction, mirroring `validateBookingOwnership`. */
const WRITE_RESTRICTION = {
  OR: [{ creatorId: USER_ID }, { custodianUserId: USER_ID }],
};

/**
 * Runs the loader and returns the `where` Prisma was asked for.
 *
 * @param role - The caller's effective role, driving the write restriction.
 * @param canSeeAllBookings - The resolved read-visibility flag under test.
 * @returns The Prisma `where` from the resulting booking query.
 */
async function whereFor(role: OrganizationRoles, canSeeAllBookings: boolean) {
  findManyMock.mockClear();

  await loadBookingsData({
    request: new Request(
      "http://localhost/assets/a1/overview/add-to-existing-booking"
    ),
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role,
    canSeeAllBookings,
    ids: ["a1"],
  });

  return findManyMock.mock.calls.at(-1)?.[0]?.where;
}

/** Every combination the two dialogs can be loaded under. */
const RESTRICTED_ROLES = [
  OrganizationRoles.SELF_SERVICE,
  OrganizationRoles.BASE,
];
const PRIVILEGED_ROLES = [OrganizationRoles.ADMIN, OrganizationRoles.OWNER];

describe("loadBookingsData booking visibility", () => {
  describe("read restriction", () => {
    it.each(RESTRICTED_ROLES)(
      "restricts %s to their own bookings, via EITHER custody link",
      async (role) => {
        const where = await whereFor(role, false);

        expect(where.AND).toEqual(
          expect.arrayContaining([
            expect.objectContaining(CUSTODIAN_RESTRICTION),
          ])
        );
      }
    );

    it.each(RESTRICTED_ROLES)(
      "drops the custodian scope for %s when the workspace enables it",
      async (role) => {
        const where = await whereFor(role, true);

        expect(where.AND).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining(CUSTODIAN_RESTRICTION),
          ])
        );
      }
    );

    it.each(PRIVILEGED_ROLES)("never restricts %s", async (role) => {
      const where = await whereFor(role, true);

      const restrictions = (where.AND ?? []).filter(
        (clause: Record<string, unknown>) =>
          JSON.stringify(clause).includes("custodianTeamMemberId") ||
          JSON.stringify(clause).includes("custodianUserId")
      );

      expect(restrictions).toEqual([]);
    });
  });

  describe("write restriction", () => {
    // The dead end this exists to prevent: with the workspace setting ON, the
    // read rule alone offered bookings `validateBookingOwnership` then 403s on.
    it.each(RESTRICTED_ROLES)(
      "keeps %s inside what the submitting action accepts, setting ON",
      async (role) => {
        const where = await whereFor(role, true);

        expect(where.AND).toEqual(
          expect.arrayContaining([expect.objectContaining(WRITE_RESTRICTION)])
        );
      }
    );

    it.each(RESTRICTED_ROLES)(
      "applies to %s alongside the read rule, setting OFF",
      async (role) => {
        const where = await whereFor(role, false);

        expect(where.AND).toEqual(
          expect.arrayContaining([
            expect.objectContaining(CUSTODIAN_RESTRICTION),
            expect.objectContaining(WRITE_RESTRICTION),
          ])
        );
      }
    );

    it.each(PRIVILEGED_ROLES)(
      "does not constrain %s, who may write to every booking",
      async (role) => {
        const where = await whereFor(role, true);

        // Asserting on the clause, not on the string "creatorId" — the
        // draft-visibility clause legitimately carries that key.
        expect(where.AND ?? []).not.toContainEqual(WRITE_RESTRICTION);
      }
    );
  });

  it("never drops the draft-visibility clause, whichever way the flags go", async () => {
    for (const role of [...RESTRICTED_ROLES, ...PRIVILEGED_ROLES]) {
      for (const flag of [true, false]) {
        const where = await whereFor(role, flag);
        const serialized = JSON.stringify(where.AND ?? []);

        expect(serialized).toContain("DRAFT");
        expect(serialized).toContain("creatorId");
      }
    }
  });
});
