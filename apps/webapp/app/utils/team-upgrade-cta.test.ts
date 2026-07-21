import { describe, expect, it } from "vitest";

import { resolveTeamUpgradeCta } from "./team-upgrade-cta";

describe("resolveTeamUpgradeCta", () => {
  it("sends Team-entitled users straight to workspace creation", () => {
    /**
     * tier_2 and custom already pay for Team, so the only thing missing is the
     * workspace itself. They must never be sent to billing.
     */
    for (const tierId of ["tier_2", "custom"] as const) {
      for (const usedFreeTrial of [true, false]) {
        expect(resolveTeamUpgradeCta({ tierId, usedFreeTrial })).toEqual({
          to: "/account-details/workspace",
          label: "Create a Team workspace",
        });
      }
    }
  });

  it("offers the trial to free users who still have one", () => {
    expect(
      resolveTeamUpgradeCta({ tierId: "free", usedFreeTrial: false })
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
      resolveTeamUpgradeCta({ tierId: "free", usedFreeTrial: true })
    ).toEqual({
      to: "/account-details/subscription",
      label: "Upgrade to Team",
    });
  });

  it("treats a paying Plus customer as an upgrade, not a trial", () => {
    expect(
      resolveTeamUpgradeCta({ tierId: "tier_1", usedFreeTrial: true })
    ).toEqual({
      to: "/account-details/subscription",
      label: "Upgrade to Team",
    });
  });

  it("still offers Plus a trial if they somehow never used one", () => {
    expect(
      resolveTeamUpgradeCta({ tierId: "tier_1", usedFreeTrial: false })
    ).toEqual({
      to: "/account-details/subscription",
      label: "Start a Team trial",
    });
  });
});
