/**
 * User Action Resolver — invite role validation
 *
 * Pins that the "resend invite" path cannot mint an OWNER invite.
 *
 * The resend handler takes a free-text `userFriendlyRole` from the form and
 * reverse-maps it through `organizationRolesMap`, which contains an OWNER entry
 * because it doubles as the display map for the team list. Without a guard,
 * posting `userFriendlyRole=Owner` resolves to `OrganizationRoles.OWNER` and
 * creates an invite granting ownership — the same escalation the invite dialog
 * and the CSV import both refuse.
 *
 * Found by sweeping siblings while fixing detail.dev finding D032, which
 * reported only the CSV import path.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../invite/roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInvite } from "~/modules/invite/service.server";
import { resolveUserAction } from "./utils.server";

// @vitest-environment node

// why: the resend path writes invites and sends email
vi.mock("../invite/service.server", () => ({ createInvite: vi.fn() }));

// why: resend invalidates prior invites for the same invitee first
vi.mock("~/database/db.server", () => ({
  db: {
    invite: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    organization: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ name: "Org", customEmailFooter: null }),
    },
  },
}));

// why: success notifications are a side effect, not part of the contract
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: avoids a real mail transport
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

/** Builds the resend POST an attacker would hand-craft */
function resendRequest(userFriendlyRole: string) {
  const body = new URLSearchParams({
    intent: "resend",
    email: "invitee@example.com",
    name: "Invitee",
    teamMemberId: "tm-1",
    userFriendlyRole,
  });

  return new Request("http://localhost/settings/team/invites", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("resolveUserAction — resend invite role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createInvite).mockResolvedValue({ id: "invite-1" } as any);
  });

  it("refuses to resend an invite as Owner", async () => {
    await expect(
      resolveUserAction(
        resendRequest("Owner"),
        "org-1",
        "admin-user",
        OrganizationRoles.ADMIN
      )
    ).rejects.toThrow(/invalid role/i);

    // The invite must never be created — that write is the escalation
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("still resends an invite for an invitable role", async () => {
    await resolveUserAction(
      resendRequest("Administrator"),
      "org-1",
      "admin-user",
      OrganizationRoles.ADMIN
    );

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ roles: [OrganizationRoles.ADMIN] })
    );
  });
});
