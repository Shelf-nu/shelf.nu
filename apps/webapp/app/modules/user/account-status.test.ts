/**
 * Account status labels for the admin user list.
 *
 * The label answers a billing question, and the answer for an invited member
 * lives on somebody else's row: Shelf bills the workspace OWNER, so a member of
 * a paid team is themselves on the free tier. Reading the member's own tier
 * produces a plausible, wrong label that nothing else in the app contradicts —
 * which is what these tests pin.
 *
 * @see {@link file://./account-status.ts}
 */
import { OrganizationRoles, OrganizationType, TierId } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { ResolvedFormatPrefs } from "~/utils/date-format";

import type {
  MembershipForAccountStatus,
  SubscriptionForAccountStatus,
  UserForAccountStatus,
} from "./account-status";
import { getAccountStatus } from "./account-status";

const prefs: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "UTC",
};

/** A workspace this user belongs to but does not own. */
function joinedTeam(
  ownerTierId: TierId,
  id = "team1"
): MembershipForAccountStatus {
  return {
    roles: [OrganizationRoles.BASE],
    organization: {
      id,
      type: OrganizationType.TEAM,
      userId: "somebody-else",
      owner: { tierId: ownerTierId },
    },
  };
}

/** A workspace this user owns. */
function ownedWorkspace(
  type: OrganizationType,
  tierId: TierId
): MembershipForAccountStatus {
  return {
    roles: [OrganizationRoles.OWNER],
    organization: { id: "own1", type, userId: "user1", owner: { tierId } },
  };
}

function user(
  overrides: Partial<UserForAccountStatus> = {}
): UserForAccountStatus {
  return {
    id: "user1",
    tierId: TierId.free,
    subscription: null,
    userOrganizations: [],
    ...overrides,
  };
}

describe("getAccountStatus", () => {
  describe("someone invited into a team", () => {
    it("reads the team owner's tier, not the member's own", () => {
      // The member sits on `free` — every invited member does — while the team
      // they were invited to is paid for by its owner.
      const status = getAccountStatus(
        user({
          tierId: TierId.free,
          userOrganizations: [joinedTeam(TierId.tier_2)],
        }),
        prefs
      );

      expect(status).toBe("Member (Invited to paid)");
    });

    it("does not count the member's own personal subscription as the team paying", () => {
      // A member who separately bought Plus for their personal workspace is no
      // evidence at all about the team that invited them.
      const status = getAccountStatus(
        user({
          tierId: TierId.tier_1,
          userOrganizations: [joinedTeam(TierId.free)],
        }),
        prefs
      );

      expect(status).toBe("Member (Invited to team)");
    });

    it("says invited-to-team when the team owner has not paid", () => {
      expect(
        getAccountStatus(
          user({ userOrganizations: [joinedTeam(TierId.free)] }),
          prefs
        )
      ).toBe("Member (Invited to team)");
    });

    it("prefers a paid team when the member belongs to several", () => {
      // The question is whether this person is already inside a paying team;
      // one free team among their memberships does not make the answer no.
      const status = getAccountStatus(
        user({
          userOrganizations: [
            joinedTeam(TierId.free, "free-team"),
            joinedTeam(TierId.custom, "paid-team"),
          ],
        }),
        prefs
      );

      expect(status).toBe("Member (Invited to paid)");
    });
  });

  describe("someone who owns a team", () => {
    it("reads their own tier, because they are the billing party", () => {
      expect(
        getAccountStatus(
          user({
            tierId: TierId.tier_2,
            userOrganizations: [
              ownedWorkspace(OrganizationType.TEAM, TierId.tier_2),
            ],
          }),
          prefs
        )
      ).toBe("Owner (Paid - Team)");
    });

    it("reports a trial with its end date", () => {
      const trialEnd = Math.floor(
        new Date("2026-03-14T00:00:00Z").getTime() / 1000
      );
      const subscription: SubscriptionForAccountStatus = {
        status: "trialing",
        trial_end: trialEnd,
      };

      const status = getAccountStatus(
        user({
          tierId: TierId.tier_2,
          subscription,
          userOrganizations: [
            ownedWorkspace(OrganizationType.TEAM, TierId.tier_2),
          ],
        }),
        prefs
      );

      expect(status).toContain("Owner (Trial - ends ");
    });

    it("counts ownership recorded only as the organization's userId", () => {
      // Ownership is recorded twice — an OWNER role and the org's `userId` —
      // and rows carrying only the latter are still the billing party.
      const status = getAccountStatus(
        user({
          tierId: TierId.tier_2,
          userOrganizations: [
            {
              roles: [OrganizationRoles.ADMIN],
              organization: {
                id: "own1",
                type: OrganizationType.TEAM,
                userId: "user1",
                owner: { tierId: TierId.tier_2 },
              },
            },
          ],
        }),
        prefs
      );

      expect(status).toBe("Owner (Paid - Team)");
    });

    it("says free when the team exists but nothing is paid for it", () => {
      expect(
        getAccountStatus(
          user({
            tierId: TierId.free,
            userOrganizations: [
              ownedWorkspace(OrganizationType.TEAM, TierId.free),
            ],
          }),
          prefs
        )
      ).toBe("Owner (Free)");
    });
  });

  describe("someone with only a personal workspace", () => {
    it("reports Plus", () => {
      expect(
        getAccountStatus(
          user({
            tierId: TierId.tier_1,
            userOrganizations: [
              ownedWorkspace(OrganizationType.PERSONAL, TierId.tier_1),
            ],
          }),
          prefs
        )
      ).toBe("Owner (Paid - Plus)");
    });

    it("reports free", () => {
      expect(
        getAccountStatus(
          user({
            userOrganizations: [
              ownedWorkspace(OrganizationType.PERSONAL, TierId.free),
            ],
          }),
          prefs
        )
      ).toBe("Owner (Free)");
    });
  });
});
