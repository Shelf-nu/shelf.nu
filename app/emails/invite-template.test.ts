import { describe, expect, it } from "vitest";

import { invitationTemplateString } from "~/emails/invite-template";
import type { InviteWithInviterAndOrg } from "~/modules/invite/types";

const invite = {
  id: "invite-id",
  inviteeEmail: "carlos@example.com",
  inviter: {
    firstName: "Alice",
    lastName: "Doe",
  },
  organization: {
    name: "Shelf Org",
  },
} as InviteWithInviterAndOrg;

describe("invitationTemplateString", () => {
  it("includes a fallback invite URL", () => {
    const token = "test-token";
    const html = invitationTemplateString({
      invite,
      token,
      extraMessage: null,
    });

    const expectedUrl = `${process.env.SERVER_URL}/accept-invite/${invite.id}?token=${token}`;

    expect(html).toContain(
      `Or paste this link into your browser: ${expectedUrl}`
    );
  });
});
