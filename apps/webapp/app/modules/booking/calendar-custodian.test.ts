/**
 * Calendar custodian projection tests.
 *
 * Pins what each viewer receives for a booking's custodian on the calendar:
 * the full identity (with the team member id the badge links to) when they
 * may see it, and nothing identifying otherwise.
 *
 * @see {@link file://./calendar-custodian.ts}
 */
import { describe, expect, it } from "vitest";
import { buildCalendarCustodian } from "./calendar-custodian";

const booking = {
  custodianTeamMemberId: "tm-1",
  custodianUserId: "user-custodian",
  custodianUser: {
    firstName: "Kim",
    lastName: "Mohnacs",
    displayName: "Kim M",
    profilePicture: null,
  },
};

describe("buildCalendarCustodian", () => {
  it("sends the custodian, with its team member id, to a viewer who sees all custody", () => {
    const custodian = buildCalendarCustodian({
      booking,
      custodianName: "Kim M",
      viewerUserId: "user-viewer",
      canSeeAllCustody: true,
    });

    expect(custodian).toEqual({
      id: "tm-1",
      name: "Kim M",
      user: {
        id: "user-custodian",
        firstName: "Kim",
        lastName: "Mohnacs",
        displayName: "Kim M",
        profilePicture: null,
      },
    });
  });

  it("sends the custodian to the custodian themself", () => {
    const custodian = buildCalendarCustodian({
      booking,
      custodianName: "Kim M",
      viewerUserId: "user-custodian",
      canSeeAllCustody: false,
    });

    expect(custodian.id).toBe("tm-1");
    expect(custodian.user?.id).toBe("user-custodian");
  });

  it("empties every identifying field for a viewer who may not see it", () => {
    const custodian = buildCalendarCustodian({
      booking,
      custodianName: "Kim M",
      viewerUserId: "user-viewer",
      canSeeAllCustody: false,
    });

    expect(custodian).toEqual({ id: null, name: "", user: undefined });
  });

  it("hides a custodian without a user account from a restricted viewer", () => {
    const custodian = buildCalendarCustodian({
      booking: { ...booking, custodianUserId: null, custodianUser: null },
      custodianName: "External Contractor",
      viewerUserId: "user-viewer",
      canSeeAllCustody: false,
    });

    expect(custodian).toEqual({ id: null, name: "", user: undefined });
  });
});
