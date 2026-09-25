/**
 * Custodian picker scope rules.
 *
 * Custodian pickers answer three different questions, and one rule cannot
 * serve them all: a FILTER asks "whose custody may I look at" (custody
 * visibility governs it), an ASSIGNMENT asks "who may I hand this asset to"
 * (the role's `custody.assign` scope, which visibility never widens), and a
 * BOOKING CUSTODIAN asks "who may this booking be assigned to" (the role's
 * booking custodian picker).
 *
 * @see {@link file://./service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

import { bookingCustodianIsSelf } from "~/utils/bookings";
import { resolveCustodianPickerScope } from "./service.server";

// why: service.server imports ~/database/db.server, whose non-production branch
// eagerly runs `void db.$connect()` at import time; with the placeholder test
// DATABASE_URL that rejects as an unhandled rejection. The resolver under test
// is pure, so the module is stubbed out entirely.
vi.mock("~/database/db.server", () => ({ db: {} }));

const ME = "user-me";

/** Access for one role, with custody visibility forced to `seeAll`. */
function accessWith(role: OrganizationRoles, seeAll = false) {
  const access = accessFor([role]);
  return { ...access, custody: { ...access.custody, seeAll } };
}

describe("resolveCustodianPickerScope", () => {
  describe("custody-filter", () => {
    it.each([
      [OrganizationRoles.ADMIN, true, "all"],
      [OrganizationRoles.OWNER, true, "all"],
      [OrganizationRoles.SELF_SERVICE, false, "self"],
      [OrganizationRoles.SELF_SERVICE, true, "all"],
      [OrganizationRoles.BASE, false, "self"],
      [OrganizationRoles.BASE, true, "all"],
    ])("%s with custody.seeAll=%s resolves to %s", (role, seeAll, mode) => {
      expect(
        resolveCustodianPickerScope({
          purpose: "custody-filter",
          access: accessWith(role, seeAll),
          userId: ME,
        }).mode
      ).toBe(mode);
    });

    it("follows the workspace toggle folded into access", () => {
      expect(
        resolveCustodianPickerScope({
          purpose: "custody-filter",
          access: accessFor([OrganizationRoles.BASE], {
            baseUserCanSeeCustody: true,
          }),
          userId: ME,
        }).mode
      ).toBe("all");
    });
  });

  describe("custody-assignment", () => {
    it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
      "%s may assign to anyone",
      (role) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-assignment",
            access: accessWith(role, true),
            userId: ME,
          }).mode
        ).toBe("all");
      }
    );

    it.each([true, false])(
      "SELF_SERVICE may assign only to themselves (seeAll=%s)",
      (seeAll) => {
        // Custody visibility is about SEEING custody; it never widens assignment.
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-assignment",
            access: accessWith(OrganizationRoles.SELF_SERVICE, seeAll),
            userId: ME,
          })
        ).toEqual({ mode: "self", userId: ME });
      }
    );

    it.each([true, false])(
      "BASE may not assign at all (seeAll=%s)",
      (seeAll) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-assignment",
            access: accessWith(OrganizationRoles.BASE, seeAll),
            userId: ME,
          })
        ).toEqual({ mode: "none" });
      }
    );

    it("a mixed membership follows its highest role, not its first", () => {
      expect(
        resolveCustodianPickerScope({
          purpose: "custody-assignment",
          access: accessFor([
            OrganizationRoles.SELF_SERVICE,
            OrganizationRoles.ADMIN,
          ]),
          userId: ME,
        }).mode
      ).toBe("all");
    });
  });

  /**
   * Being a booking's custodian is NOT holding custody of an asset. BASE has
   * `booking:create`, so it must be able to name itself on a booking even
   * though it may never take asset custody: treating this as
   * `custody-assignment` would return nothing and leave BASE unable to create
   * a booking at all.
   */
  describe("booking-custodian", () => {
    it.each([
      [OrganizationRoles.ADMIN, "all"],
      [OrganizationRoles.OWNER, "all"],
      [OrganizationRoles.SELF_SERVICE, "self"],
      [OrganizationRoles.BASE, "self"],
    ])("%s resolves to %s whatever custody visibility says", (role, mode) => {
      for (const seeAll of [true, false]) {
        expect(
          resolveCustodianPickerScope({
            purpose: "booking-custodian",
            access: accessWith(role, seeAll),
            userId: ME,
          }).mode
        ).toBe(mode);
      }
    });

    it("is unaffected by the visibility toggles", () => {
      // The toggles govern SEEING bookings and custody; they say nothing about
      // who a booking may be assigned to.
      expect(
        resolveCustodianPickerScope({
          purpose: "booking-custodian",
          access: accessFor([OrganizationRoles.SELF_SERVICE], {
            selfServiceCanSeeBookings: true,
            selfServiceCanSeeCustody: true,
          }),
          userId: ME,
        })
      ).toEqual({ mode: "self", userId: ME });
    });

    it("judges a mixed membership by its highest role", () => {
      expect(
        resolveCustodianPickerScope({
          purpose: "booking-custodian",
          access: accessFor([OrganizationRoles.BASE, OrganizationRoles.ADMIN]),
          userId: ME,
        }).mode
      ).toBe("all");
    });
  });
});

/**
 * The seed and the search must agree.
 *
 * When they do not, the picker's list changes the moment the user types, and a
 * restricted user sees the whole roster. These assertions encode the value each seed passes as
 * `filterByUserId` / `returnNone`, so a change to the resolver that would
 * desynchronise them fails here.
 */
describe("seed and search agree", () => {
  const CASES = [
    { role: OrganizationRoles.SELF_SERVICE, canSeeAllCustody: false },
    { role: OrganizationRoles.SELF_SERVICE, canSeeAllCustody: true },
    { role: OrganizationRoles.BASE, canSeeAllCustody: false },
    { role: OrganizationRoles.BASE, canSeeAllCustody: true },
    { role: OrganizationRoles.ADMIN, canSeeAllCustody: true },
    { role: OrganizationRoles.OWNER, canSeeAllCustody: true },
  ];

  it.each(CASES)(
    "filter: $role / canSeeAllCustody=$canSeeAllCustody matches what the seeds pass",
    ({ role, canSeeAllCustody }) => {
      const scope = resolveCustodianPickerScope({
        purpose: "custody-filter",
        access: accessWith(role, canSeeAllCustody),
        userId: ME,
      });

      // Every filter seed passes `filterByUserId: !access.custody.seeAll`.
      expect(scope.mode === "self").toBe(!canSeeAllCustody);
      expect(scope.mode).not.toBe("none");
    }
  );

  it.each(CASES)(
    "assignment: $role ignores the override entirely",
    ({ role, canSeeAllCustody }) => {
      const scope = resolveCustodianPickerScope({
        purpose: "custody-assignment",
        access: accessWith(role, canSeeAllCustody),
        userId: ME,
      });

      if (role === OrganizationRoles.BASE) {
        expect(scope.mode).toBe("none");
      } else if (role === OrganizationRoles.SELF_SERVICE) {
        expect(scope.mode).toBe("self");
      } else {
        expect(scope.mode).toBe("all");
      }
    }
  );

  it.each(CASES)(
    "booking-custodian: $role mirrors getTeamMemberForForm's self-only branch",
    ({ role, canSeeAllCustody }) => {
      const access = accessFor([role], {
        selfServiceCanSeeCustody: canSeeAllCustody,
        baseUserCanSeeCustody: canSeeAllCustody,
      });
      const scope = resolveCustodianPickerScope({
        purpose: "booking-custodian",
        access,
        userId: ME,
      });

      // `getTeamMemberForForm` returns only the caller's own team member
      // exactly when `bookingCustodianIsSelf(access)`, so the search must too.
      expect(scope.mode).toBe(bookingCustodianIsSelf(access) ? "self" : "all");
      // ...which holds for SELF_SERVICE and BASE, whatever the toggles say.
      expect(scope.mode).toBe(
        role === OrganizationRoles.SELF_SERVICE ||
          role === OrganizationRoles.BASE
          ? "self"
          : "all"
      );
    }
  );
});
