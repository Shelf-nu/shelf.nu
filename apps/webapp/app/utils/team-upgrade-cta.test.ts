import { describe, expect, it } from "vitest";

import { resolveTeamUpgradeCta } from "./team-upgrade-cta";

describe("resolveTeamUpgradeCta", () => {
  it("sends Team-entitled users straight to workspace creation", () => {
    /**
     * Their plan already permits a Team workspace, so the only thing missing
     * is the workspace itself. They must never be sent to billing.
     */
    for (const usedFreeTrial of [true, false]) {
      expect(
        resolveTeamUpgradeCta({ canCreateTeamWorkspace: true, usedFreeTrial })
      ).toEqual({
        to: "/account-details/workspace",
        label: "Create a Team workspace",
      });
    }
  });

  it("offers the trial to unentitled users who still have one", () => {
    expect(
      resolveTeamUpgradeCta({
        canCreateTeamWorkspace: false,
        usedFreeTrial: false,
      })
    ).toEqual({
      to: "/account-details/subscription",
      label: "Start a Team trial",
    });
  });

  it("never offers a second trial once it has been spent", () => {
    /**
     * The subscription action throws "You have already used your free trial",
     * so a trial CTA here would send the user to a dead end.
     */
    expect(
      resolveTeamUpgradeCta({
        canCreateTeamWorkspace: false,
        usedFreeTrial: true,
      })
    ).toEqual({
      to: "/account-details/subscription",
      label: "Upgrade to Team",
    });
  });

  it("keys the destination on entitlement alone, never on the trial flag", () => {
    /**
     * `usedFreeTrial` may only change the wording. If it ever reaches the
     * destination, a paying customer gets routed to billing for something
     * they already have.
     */
    const destinations = [true, false].map(
      (usedFreeTrial) =>
        resolveTeamUpgradeCta({ canCreateTeamWorkspace: true, usedFreeTrial })
          .to
    );

    expect(new Set(destinations).size).toBe(1);
  });
});

/**
 * Entitlement does not follow from a tier id, and these pin the situations
 * where it comes from somewhere else: a deployment with premium features off,
 * an admin-set `CustomTierLimit`, and a plan whose allowance is already spent
 * on a workspace that exists.
 *
 * The caller computes `canCreateTeamWorkspace` as
 * `!premiumIsEnabled || tierLimit.maxOrganizations > 1`
 * (see `routes/_layout+/settings.team.tsx`).
 */
describe("resolveTeamUpgradeCta — entitlement beyond the tier id", () => {
  it("routes a self-hosted user to workspace creation, not billing", () => {
    /**
     * With premium features disabled nothing is gated, and
     * `/account-details/subscription` redirects to account settings — so a
     * trial CTA lands the user on a page about their name and email.
     */
    expect(
      resolveTeamUpgradeCta({
        canCreateTeamWorkspace: true, // !premiumIsEnabled
        usedFreeTrial: false,
      })
    ).toEqual({
      to: "/account-details/workspace",
      label: "Create a Team workspace",
    });
  });

  it("routes a user granted extra workspaces by an admin to workspace creation", () => {
    /**
     * `CustomTierLimit.maxOrganizations` is set per user from the admin
     * dashboard, so entitlement does not have to follow the tier id.
     */
    expect(
      resolveTeamUpgradeCta({
        canCreateTeamWorkspace: true, // custom limit > 1
        usedFreeTrial: true,
      })
    ).toEqual({
      to: "/account-details/workspace",
      label: "Create a Team workspace",
    });
  });

  it("keeps offering creation to a Team user who already made their workspace", () => {
    /**
     * Entitlement, not headroom: `tier_2` allows 2 organizations, so a user
     * with Personal + Team has none left to create but is plainly still
     * entitled. Telling them to upgrade would be the worst answer available.
     */
    expect(
      resolveTeamUpgradeCta({
        canCreateTeamWorkspace: true,
        usedFreeTrial: true,
      }).label
    ).toBe("Create a Team workspace");
  });
});
