import { describe, expect, it } from "vitest";

import { signalsTeamIntent } from "./constants";

describe("signalsTeamIntent", () => {
  it("returns false when the question was never answered", () => {
    expect(signalsTeamIntent(null)).toBe(false);
    expect(signalsTeamIntent(undefined)).toBe(false);
    expect(signalsTeamIntent("")).toBe(false);
  });

  it("returns false for the solo option", () => {
    expect(signalsTeamIntent("Just me (1)")).toBe(false);
  });

  it("returns false for free-text answers outside the known options", () => {
    /**
     * teamSize is captured with SelectWithOther, so stored values are not
     * limited to TEAM_SIZE_OPTIONS. Production data contains answers like "1";
     * treating those as a team would push a solo user toward a Team workspace
     * and show them a nonsensical "your team has 1" caution.
     */
    expect(signalsTeamIntent("1")).toBe(false);
    expect(signalsTeamIntent("just me")).toBe(false);
    expect(signalsTeamIntent("2")).toBe(false);
  });

  it("returns true for the known multi-person options", () => {
    expect(signalsTeamIntent("Small team (2-10)")).toBe(true);
    expect(signalsTeamIntent("Department (11-50)")).toBe(true);
    expect(signalsTeamIntent("Large organization (50+)")).toBe(true);
  });
});
