/**
 * Signup intent parsing and routing helpers.
 *
 * @see {@link file://./schema.ts}
 */
import { describe, expect, it } from "vitest";
import {
  hasTeamPlanIntent,
  parsePlanIntentFromSearchParams,
  parseSignupIntentFromSearchParams,
  planIntentSearchParams,
  resolveOnboardingDestination,
  signupIntentNotice,
} from "./schema";

function parse(query: string) {
  return parseSignupIntentFromSearchParams(new URLSearchParams(query));
}

describe("parseSignupIntentFromSearchParams", () => {
  it("reads the website's Team-trial link in full", () => {
    expect(
      parse(
        "plan=team&trial=true&utm_source=website&utm_medium=pricing&utm_campaign=launch&utm_content=hero"
      )
    ).toEqual({
      plan: "team",
      trial: true,
      utmSource: "website",
      utmMedium: "pricing",
      utmCampaign: "launch",
      utmContent: "hero",
    });
  });

  it("returns null when the query string carries no intent", () => {
    expect(parse("")).toBeNull();
    expect(parse("foo=bar&mode=login")).toBeNull();
  });

  it("only knows the team and plus plans, case-insensitively", () => {
    expect(parse("plan=Team")).toEqual({ plan: "team" });
    expect(parse("plan=plus")).toEqual({ plan: "plus" });
    expect(parse("plan=enterprise")).toBeNull();
    expect(parse("plan=")).toBeNull();
  });

  it("reads the trial flag as a boolean and ignores other spellings", () => {
    expect(parse("plan=team&trial=1")).toEqual({ plan: "team", trial: true });
    expect(parse("plan=team&trial=false")).toEqual({
      plan: "team",
      trial: false,
    });
    expect(parse("plan=team&trial=yes")).toEqual({ plan: "team" });
  });

  it("drops a bad field without dropping its neighbours", () => {
    const tooLong = "x".repeat(101);
    expect(parse(`plan=team&utm_source=${tooLong}&utm_medium=pricing`)).toEqual(
      { plan: "team", utmMedium: "pricing" }
    );
  });

  it("trims campaign values and ignores blank ones", () => {
    expect(parse("utm_source=%20website%20&utm_campaign=%20%20")).toEqual({
      utmSource: "website",
    });
  });

  it("keeps an in-app redirectTo", () => {
    expect(parse("redirectTo=%2Fqr%2Fabc")).toEqual({ redirectTo: "/qr/abc" });
  });
});

describe("parsePlanIntentFromSearchParams", () => {
  it("reads the plan page's query string back into a decided trial flag", () => {
    expect(
      parsePlanIntentFromSearchParams(
        new URLSearchParams("plan=team&trial=true")
      )
    ).toEqual({ plan: "team", trial: true });
    expect(
      parsePlanIntentFromSearchParams(new URLSearchParams("plan=team"))
    ).toEqual({ plan: "team", trial: false });
  });

  it("is null when no plan is named, whatever else is there", () => {
    expect(
      parsePlanIntentFromSearchParams(new URLSearchParams("withAudits=true"))
    ).toBeNull();
    expect(
      parsePlanIntentFromSearchParams(new URLSearchParams("trial=true"))
    ).toBeNull();
    expect(
      parsePlanIntentFromSearchParams(new URLSearchParams("plan=gold"))
    ).toBeNull();
  });
});

describe("hasTeamPlanIntent", () => {
  it("is true only for a Team plan", () => {
    expect(hasTeamPlanIntent({ plan: "team" })).toBe(true);
    expect(hasTeamPlanIntent({ plan: "plus" })).toBe(false);
    expect(hasTeamPlanIntent({ utmSource: "website" })).toBe(false);
    expect(hasTeamPlanIntent(null)).toBe(false);
  });
});

describe("planIntentSearchParams", () => {
  it("carries only the plan and the trial flag", () => {
    expect(
      planIntentSearchParams({
        plan: "team",
        trial: true,
        utmSource: "website",
        redirectTo: "/assets",
      })
    ).toBe("plan=team&trial=true");
    expect(planIntentSearchParams({ plan: "team" })).toBe("plan=team");
  });
});

describe("signupIntentNotice", () => {
  it("confirms a Team trial with its length", () => {
    expect(
      signupIntentNotice({
        intent: { plan: "team", trial: true },
        freeTrialDays: 7,
      })
    ).toBe("You're starting a Team trial. 7 days, no credit card.");
  });

  it("confirms a Team plan without a trial", () => {
    expect(
      signupIntentNotice({ intent: { plan: "team" }, freeTrialDays: 7 })
    ).toBe("You're signing up for the Team plan.");
  });

  it("says nothing without a Team plan", () => {
    expect(signupIntentNotice({ intent: null, freeTrialDays: 7 })).toBeNull();
    expect(
      signupIntentNotice({ intent: { plan: "plus" }, freeTrialDays: 7 })
    ).toBeNull();
    expect(
      signupIntentNotice({
        intent: { utmSource: "website", trial: true },
        freeTrialDays: 7,
      })
    ).toBeNull();
  });
});

describe("resolveOnboardingDestination", () => {
  it("sends a Team intent straight to the plan page", () => {
    expect(
      resolveOnboardingDestination({
        redirectViaInvite: false,
        signupIntent: { plan: "team", trial: true },
        premiumFeaturesEnabled: true,
      })
    ).toBe("/select-plan?plan=team&trial=true");
    expect(
      resolveOnboardingDestination({
        redirectViaInvite: false,
        signupIntent: { plan: "team" },
        premiumFeaturesEnabled: true,
      })
    ).toBe("/select-plan?plan=team");
  });

  it("keeps the Personal/Team question without a Team intent", () => {
    expect(
      resolveOnboardingDestination({
        redirectViaInvite: false,
        signupIntent: null,
        premiumFeaturesEnabled: true,
      })
    ).toBe("/welcome");
    expect(
      resolveOnboardingDestination({
        redirectViaInvite: false,
        signupIntent: { plan: "plus", utmSource: "website" },
        premiumFeaturesEnabled: true,
      })
    ).toBe("/welcome");
  });

  it("never sends anyone to the plan page without premium features", () => {
    expect(
      resolveOnboardingDestination({
        redirectViaInvite: false,
        signupIntent: { plan: "team", trial: true },
        premiumFeaturesEnabled: false,
      })
    ).toBe("/welcome");
  });

  it("invited users land in their workspace whatever the link said", () => {
    expect(
      resolveOnboardingDestination({
        redirectViaInvite: true,
        signupIntent: { plan: "team", trial: true },
        premiumFeaturesEnabled: true,
      })
    ).toBe("/assets");
  });
});
