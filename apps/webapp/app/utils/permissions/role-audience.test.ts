/**
 * Pins the wording built from the policy table: the booking notification
 * audiences and the sentence the audit dialogs show.
 *
 * @see {@link file://./role-audience.ts}
 */
import { describe, expect, it } from "vitest";
import {
  AUDIT_ANY_PERFORMER_SENTENCE,
  describeRoleAudience,
} from "./role-audience";

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

  it("builds the audit dialogs' sentence from every role that sees all audits", () => {
    expect(AUDIT_ANY_PERFORMER_SENTENCE).toBe(
      "Owners, administrators and managers can perform any audit."
    );
  });
});
