/**
 * Custodian picker scope rules.
 *
 * Custodian pickers answer two different questions, and one rule cannot serve
 * both: a FILTER asks "whose custody may I look at" (the workspace override
 * governs it), while an ASSIGNMENT asks "who may I hand this to" (a business
 * rule the override never widens).
 *
 * Getting the second wrong is what let `/scanner` — gated on `asset:read`,
 * which BASE holds — hand a BASE user the entire team roster.
 *
 * @see {@link file://./service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { resolveCustodianPickerScope } from "./service.server";

// why: service.server imports ~/database/db.server, whose non-production branch
// eagerly runs `void db.$connect()` at import time; with the placeholder test
// DATABASE_URL that rejects as an unhandled rejection. The resolver under test
// is pure, so the module is stubbed out entirely.
vi.mock("~/database/db.server", () => ({ db: {} }));

const ME = "user-me";

describe("resolveCustodianPickerScope", () => {
  describe("custody-filter", () => {
    it.each([
      [OrganizationRoles.ADMIN, true, "all"],
      [OrganizationRoles.OWNER, true, "all"],
      [OrganizationRoles.SELF_SERVICE, false, "self"],
      [OrganizationRoles.SELF_SERVICE, true, "all"],
      [OrganizationRoles.BASE, false, "self"],
      [OrganizationRoles.BASE, true, "all"],
    ])(
      "%s with canSeeAllCustody=%s resolves to %s",
      (role, canSeeAllCustody, mode) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-filter",
            role,
            canSeeAllCustody,
            userId: ME,
          }).mode
        ).toBe(mode);
      }
    );
  });

  describe("custody-assignment", () => {
    it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
      "%s may assign to anyone",
      (role) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-assignment",
            role,
            canSeeAllCustody: true,
            userId: ME,
          }).mode
        ).toBe("all");
      }
    );

    it.each([true, false])(
      "SELF_SERVICE may assign only to themselves (override=%s)",
      (canSeeAllCustody) => {
        // The override is about SEEING custody; it never widens assignment.
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-assignment",
            role: OrganizationRoles.SELF_SERVICE,
            canSeeAllCustody,
            userId: ME,
          })
        ).toEqual({ mode: "self", userId: ME });
      }
    );

    it.each([true, false])(
      "BASE may never assign custody (override=%s)",
      (canSeeAllCustody) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "custody-assignment",
            role: OrganizationRoles.BASE,
            canSeeAllCustody,
            userId: ME,
          }).mode
        ).toBe("none");
      }
    );
  });

  /**
   * Being a booking's custodian is NOT holding custody of an asset. BASE has
   * `booking:create`, so it must be able to name itself on a booking even
   * though it may never take asset custody — treating this as
   * `custody-assignment` would return nothing and leave BASE unable to create
   * a booking at all.
   */
  describe("booking-custodian", () => {
    it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
      "%s may book on anyone's behalf",
      (role) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "booking-custodian",
            role,
            canSeeAllCustody: false,
            userId: ME,
          }).mode
        ).toBe("all");
      }
    );

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "%s books only for themselves — including BASE, unlike asset custody",
      (role) => {
        expect(
          resolveCustodianPickerScope({
            purpose: "booking-custodian",
            role,
            canSeeAllCustody: false,
            userId: ME,
          })
        ).toEqual({ mode: "self", userId: ME });
      }
    );

    it("is unaffected by the custody override", () => {
      // The override governs custody VISIBILITY; it says nothing about who a
      // booking may be assigned to.
      expect(
        resolveCustodianPickerScope({
          purpose: "booking-custodian",
          role: OrganizationRoles.SELF_SERVICE,
          canSeeAllCustody: true,
          userId: ME,
        })
      ).toEqual({ mode: "self", userId: ME });
    });
  });
});

/**
 * The seed and the search must agree.
 *
 * When they do not, the picker's list changes the moment the user types — which
 * is exactly how the full team roster leaked out of a picker that had been
 * showing one name. These assertions encode the value each seed passes as
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
        role,
        canSeeAllCustody,
        userId: ME,
      });

      // Every filter seed passes `filterByUserId: !canSeeAllCustody`.
      expect(scope.mode === "self").toBe(!canSeeAllCustody);
      expect(scope.mode).not.toBe("none");
    }
  );

  it.each(CASES)(
    "assignment: $role ignores the override entirely",
    ({ role, canSeeAllCustody }) => {
      const scope = resolveCustodianPickerScope({
        purpose: "custody-assignment",
        role,
        canSeeAllCustody,
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
    "booking-custodian: $role mirrors getTeamMemberForForm's isSelfServiceOrBase branch",
    ({ role, canSeeAllCustody }) => {
      const scope = resolveCustodianPickerScope({
        purpose: "booking-custodian",
        role,
        canSeeAllCustody,
        userId: ME,
      });

      const isSelfServiceOrBase =
        role === OrganizationRoles.SELF_SERVICE ||
        role === OrganizationRoles.BASE;

      // `getTeamMemberForForm` returns only the caller's own team member for
      // exactly this set, so the search must too.
      expect(scope.mode).toBe(isSelfServiceOrBase ? "self" : "all");
    }
  );
});
