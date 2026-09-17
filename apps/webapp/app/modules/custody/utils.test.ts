/**
 * Tests for the custody helpers shared by the web asset and kit pages.
 *
 * @see {@link file://./utils.ts}
 */
import { describe, expect, it } from "vitest";
import { getCustodyCardHolderUserId } from "./utils";

describe("getCustodyCardHolderUserId", () => {
  const directCustody = [
    { custodian: { userId: "user-direct", user: { id: "user-direct" } } },
  ];

  it("names the direct custodian when there is custody, even with a booking", () => {
    // The card shows direct custody first, so that is the holder it names.
    expect(
      getCustodyCardHolderUserId({
        custody: directCustody,
        booking: {
          custodianUser: { id: "user-booking" },
          custodianTeamMember: { userId: "user-booking" },
        },
      })
    ).toBe("user-direct");
  });

  it("names the booking's user link when there is no direct custody", () => {
    expect(
      getCustodyCardHolderUserId({
        custody: [],
        booking: {
          custodianUser: { id: "user-booking" },
          custodianTeamMember: { userId: null },
        },
      })
    ).toBe("user-booking");
  });

  it("names the booking's team member's user when the booking has no user link", () => {
    // A booking assigned by picking a team member carries no user link, even
    // once that team member has an account.
    expect(
      getCustodyCardHolderUserId({
        custody: null,
        booking: {
          custodianUser: null,
          custodianTeamMember: { userId: "user-member" },
        },
      })
    ).toBe("user-member");
  });

  it("returns undefined for a holder without an account", () => {
    expect(
      getCustodyCardHolderUserId({
        custody: null,
        booking: {
          custodianUser: null,
          custodianTeamMember: { userId: null },
        },
      })
    ).toBeUndefined();
  });

  it("returns undefined when there is neither custody nor a booking", () => {
    expect(
      getCustodyCardHolderUserId({ custody: null, booking: undefined })
    ).toBeUndefined();
  });
});
