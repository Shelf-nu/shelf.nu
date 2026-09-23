/**
 * Paid team memberships for the subscription page.
 *
 * The subscription page tells an invited member that their team's plan covers
 * them, so the list must hold exactly the Team workspaces the user joined and
 * whose owner's tier keeps them running. A workspace the user owns, a team
 * whose owner is on Free or Plus (the app disables it) and a personal
 * workspace must never appear: each would tell someone they are covered by a
 * plan that does not cover them.
 *
 * @see {@link file://./paid-team-memberships.ts}
 */
import { OrganizationRoles, OrganizationType, TierId } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { MembershipForPaidTeams } from "./paid-team-memberships";
import {
  getPaidTeamMemberships,
  ownerTierRunsTeamWorkspace,
} from "./paid-team-memberships";

const USER_ID = "user1";

/** A membership row, defaulting to a paid Team workspace owned by someone else. */
function membership(
  overrides: {
    id?: string;
    name?: string;
    roles?: OrganizationRoles[];
    type?: OrganizationType;
    ownerUserId?: string;
    ownerTierId?: TierId;
  } = {}
): MembershipForPaidTeams {
  const id = overrides.id ?? "team1";
  return {
    roles: overrides.roles ?? [OrganizationRoles.BASE],
    organization: {
      id,
      name: overrides.name ?? `Workspace ${id}`,
      type: overrides.type ?? OrganizationType.TEAM,
      userId: overrides.ownerUserId ?? "somebody-else",
      owner: { tierId: overrides.ownerTierId ?? TierId.tier_2 },
    },
  };
}

describe("getPaidTeamMemberships", () => {
  it("returns a Team workspace the user joined whose owner is on Team", () => {
    const result = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [membership({ id: "t1", name: "Camera Crew" })],
    });

    expect(result).toEqual([{ id: "t1", name: "Camera Crew" }]);
  });

  it.each([
    OrganizationRoles.ADMIN,
    OrganizationRoles.BASE,
    OrganizationRoles.SELF_SERVICE,
  ])("counts a %s member", (role) => {
    const result = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [membership({ roles: [role] })],
    });

    expect(result).toHaveLength(1);
  });

  it.each([TierId.tier_2, TierId.custom])(
    "counts a team whose owner is on %s",
    (ownerTierId) => {
      const result = getPaidTeamMemberships({
        userId: USER_ID,
        memberships: [membership({ ownerTierId })],
      });

      expect(result).toHaveLength(1);
    }
  );

  it.each([TierId.free, TierId.tier_1])(
    "leaves out a team whose owner is on %s, which the app disables",
    (ownerTierId) => {
      const result = getPaidTeamMemberships({
        userId: USER_ID,
        memberships: [membership({ ownerTierId })],
      });

      expect(result).toEqual([]);
    }
  );

  it("leaves out a workspace the user holds the OWNER role in", () => {
    const result = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [membership({ roles: [OrganizationRoles.OWNER] })],
    });

    expect(result).toEqual([]);
  });

  it("leaves out a workspace whose owner id is the user, whatever the role", () => {
    // Ownership is recorded twice; the organization's `userId` alone is enough.
    const result = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [
        membership({ roles: [OrganizationRoles.ADMIN], ownerUserId: USER_ID }),
      ],
    });

    expect(result).toEqual([]);
  });

  it("leaves out a PERSONAL workspace, even one owned by a paid user", () => {
    const result = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [
        membership({
          type: OrganizationType.PERSONAL,
          ownerTierId: TierId.tier_2,
        }),
      ],
    });

    expect(result).toEqual([]);
  });

  it("returns every paid team the user joined, in the input order", () => {
    const result = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [
        membership({ id: "a", name: "Camera Crew" }),
        membership({ id: "own", roles: [OrganizationRoles.OWNER] }),
        membership({ id: "free", ownerTierId: TierId.free }),
        membership({ id: "plus", ownerTierId: TierId.tier_1 }),
        membership({
          id: "b",
          name: "Lighting Team",
          ownerTierId: TierId.custom,
        }),
        membership({ id: "p", type: OrganizationType.PERSONAL }),
      ],
    });

    expect(result).toEqual([
      { id: "a", name: "Camera Crew" },
      { id: "b", name: "Lighting Team" },
    ]);
  });

  it("returns nothing when the user has no memberships", () => {
    expect(
      getPaidTeamMemberships({ userId: USER_ID, memberships: [] })
    ).toEqual([]);
  });

  it("exposes only the workspace id and name", () => {
    const [team] = getPaidTeamMemberships({
      userId: USER_ID,
      memberships: [membership()],
    });

    expect(Object.keys(team).sort()).toEqual(["id", "name"]);
  });
});

describe("ownerTierRunsTeamWorkspace", () => {
  // Mirrors `disabledTeamOrg` in ~/utils/stripe.server, which disables a Team
  // workspace whose owner is on free or tier_1.
  it.each([
    [TierId.free, false],
    [TierId.tier_1, false],
    [TierId.tier_2, true],
    [TierId.custom, true],
  ])("%s -> %s", (tierId, expected) => {
    expect(ownerTierRunsTeamWorkspace(tierId)).toBe(expected);
  });
});
