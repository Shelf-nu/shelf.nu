/**
 * Pins the wording built from the policy table for the two audiences the
 * booking notification settings describe.
 *
 * @see {@link file://./role-audience.ts}
 */
import { describe, expect, it } from "vitest";
import { describeRoleAudience } from "./role-audience";

// @vitest-environment node

describe("describeRoleAudience", () => {
  it("names everyone who hears a reservation, most privileged first", () => {
    expect(
      describeRoleAudience((p) => p.notifications.orgBookingBroadcasts)
    ).toBe("owners, administrators and managers");
  });

  it("names everyone who can be picked as a recipient", () => {
    expect(
      describeRoleAudience((p) => p.notifications.selectableAsRecipient)
    ).toBe("owners, administrators and managers");
  });

  it("names a single role without a list", () => {
    expect(describeRoleAudience((p) => p.membership.ownsWorkspace)).toBe(
      "owners"
    );
  });

  it("returns an empty string when no role matches", () => {
    expect(describeRoleAudience(() => false)).toBe("");
  });
});
