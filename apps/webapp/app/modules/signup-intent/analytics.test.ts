/**
 * Signup intent → analytics properties.
 *
 * @see {@link file://./analytics.ts}
 */
import { describe, expect, it } from "vitest";
import {
  signupIntentEventProperties,
  signupIntentInitialPersonProperties,
} from "./analytics";

describe("signupIntentEventProperties", () => {
  it("names what the link asked for", () => {
    expect(
      signupIntentEventProperties({
        plan: "team",
        trial: true,
        utmSource: "website",
        utmMedium: "pricing",
        utmCampaign: "launch",
        utmContent: "hero",
        redirectTo: "/qr/abc",
      })
    ).toEqual({
      signup_plan: "team",
      signup_trial: true,
      utm_source: "website",
      utm_medium: "pricing",
      utm_campaign: "launch",
      utm_content: "hero",
    });
  });

  it("leaves out fields the link did not carry", () => {
    expect(signupIntentEventProperties({ utmSource: "newsletter" })).toEqual({
      utm_source: "newsletter",
    });
  });

  it("adds nothing without an intent", () => {
    expect(signupIntentEventProperties(null)).toEqual({});
    expect(signupIntentEventProperties(undefined)).toEqual({});
  });
});

describe("signupIntentInitialPersonProperties", () => {
  it("uses PostHog's initial-campaign names for the person", () => {
    expect(
      signupIntentInitialPersonProperties({
        plan: "team",
        trial: false,
        utmSource: "website",
        utmCampaign: "launch",
      })
    ).toEqual({
      initial_signup_plan: "team",
      initial_signup_trial: false,
      $initial_utm_source: "website",
      $initial_utm_campaign: "launch",
    });
  });

  it("writes nothing to the person without an intent", () => {
    expect(signupIntentInitialPersonProperties(null)).toBeUndefined();
    expect(
      signupIntentInitialPersonProperties({ redirectTo: "/assets" })
    ).toBeUndefined();
  });
});
